require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

if (!process.env.CLOUDFLARE_WORKER_URL) {
    console.error("!!! Cloudflare Worker URL not found in .env file. Summarization will fail. !!!");
}

app.use(express.static('public'));

const rooms = {};
const summaries = {};
const roomTexts = {};

// --- 텍스트 수신 및 저장 ---
io.on('connection', (socket) => {
    socket.on('join room', (roomName) => {
        socket.join(roomName);
        const otherUsers = rooms[roomName] || [];
        socket.emit('existing users', otherUsers);
        if (!rooms[roomName]) {
            rooms[roomName] = [];
        }
        rooms[roomName].push(socket.id);
        socket.to(roomName).emit('user joined', socket.id);
        console.log(`[Server] ${socket.id} joined room ${roomName}`);
    });

    socket.on('signal', (payload) => {
        io.to(payload.to).emit('signal', {
            from: socket.id,
            signal: payload.signal,
        });
    });

    socket.on('recognized text', ({ room, text }) => {
        console.log(`[Server] Received text for room ${room} from ${socket.id}: ${text.substring(0, 30)}...`);
        // (누가 보냈는지 ID와 함께 전송)
        socket.to(room).emit('new message', {
            from: socket.id,
            text: text
        });

        if (!roomTexts[room]) {
            roomTexts[room] = "";
        }
        roomTexts[room] += `참여자: ${text}\n`;
    });

    socket.on('get summary', (roomName) => {
        console.log(`[Server] Summary requested for room ${roomName}`);
        const roomData = summaries[roomName];
        let summaryToSend = '해당 회의방의 요약본을 찾을 수 없습니다.';
        if (roomData) {
            const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
            if (roomData.timestamp > twentyFourHoursAgo) {
                summaryToSend = roomData.summary;
            } else {
                summaryToSend = '회의가 종료된 지 24시간이 경과하여 요약본을 다운로드할 수 없습니다.';
                delete summaries[roomName];
            }
        }
        socket.emit('summary received', { roomCode: roomName, summaryText: summaryToSend });
    });

    // --- 회의 종료 시 요약 실행 ---
    socket.on('disconnect', async () => {
        console.log(`[Server] ${socket.id} disconnected`);
        let disconnectedRoom = null;
        for (const roomName in rooms) {
            const userIndex = rooms[roomName].indexOf(socket.id);
            if (userIndex > -1) {
                rooms[roomName].splice(userIndex, 1);
                socket.to(roomName).emit('user left', socket.id);
                disconnectedRoom = roomName;

                if (rooms[roomName].length === 0) {
                    console.log(`[Server] Last user left room ${roomName}. Summarizing...`);
                    const fullText = roomTexts[roomName];
                    if (fullText) {
                        let summaryResult = "[AI 요약 실패]";
                        try {
                            summaryResult = await summarizeTextCloudflare(fullText);
                            summaryResult = cleanSummary(summaryResult); // 여기서 정리
                            console.log(`[Server] Summary for room ${roomName} processed.`);
                        } catch (summaryError){
                            console.error(`[Server] Failed to summarize room ${roomName}:`, summaryError);
                            summaryResult = "[AI 요약 중 오류 발생]";
                        } finally {
                            if (!summaries[roomName]) {
                                summaries[roomName] = { summary: `--- 회의록: 방 ${roomName} ---\n\n`, timestamp: Date.now() };
                            }
                            summaries[roomName].summary += "[AI 요약]\n" + summaryResult + "\n\n"; // 정리된 요약 저장
                            summaries[roomName].summary += "--- 전체 대화 내용 ---\n" + fullText;
                            console.log(`[Server] Full log for room ${roomName} stored.`);
                            delete roomTexts[roomName];
                        }
                    } else {
                        console.log(`[Server] No text recorded for room ${roomName}.`);
                    }
                    delete rooms[roomName];
                    console.log(`[Server] Room ${roomName} removed as it is empty.`);
                }
                break;
            }
        }
    });
});

// --- Cloudflare Worker 요약 함수  ---
async function summarizeTextCloudflare(text) {
    if (!text || text.length < 30) {
        return "요약할 내용이 부족합니다.";
    }
    const workerUrl = process.env.CLOUDFLARE_WORKER_URL;
    if (!workerUrl) {
        console.error("[Server] Cloudflare Worker URL not found in .env file!");
        return "[Cloudflare Worker URL 설정 필요]";
    }

    try {
        console.log(`[Server] Requesting summary from Cloudflare Worker...`);
        const prompt = `다음 대화 내용을 오직 한국어로만 간결하게 요약해줘. 중요한 결정이나 행동 계획 위주로 정리하고, 각 요점은 불렛 포인트(-)로 시작해야 해. 다른 부가 설명은 절대 추가하지 마.\n\n대화 내용:\n"${text}"\n\n요약:`;

        const response = await axios.post(workerUrl, { text: prompt }); // Worker 스크립트가 { text: ... } 를 받음

        const rawSummary = response.data?.summary || "[Llama 2 AI 요약 실패]";
        console.log(`[Server] Cloudflare Raw Summary received: ${rawSummary}`);

        // 정리는 cleanSummary 함수에 맡김
        return rawSummary;

    } catch (error) {
        console.error("[Server] Error calling Cloudflare Worker:", error.response ? JSON.stringify(error.response.data) : error.message);
        throw new Error("[AI 요약 중 오류 발생]");
    }
}

// --- 요약 텍스트 정리 함수 (영어 제거 강화) ---
function cleanSummary(rawText) {
    if (!rawText || typeof rawText !== 'string') return rawText;

    // 1. 불렛 포인트(-)가 처음 나오는 부분부터 유효한 내용으로 간주
    const bulletIndex = rawText.indexOf('-');
    let cleaned = rawText;
    if (bulletIndex !== -1) {
        cleaned = rawText.substring(bulletIndex);
    } else {
        // 불렛 포인트가 아예 없으면 일단 원본 사용 (모델이 지시를 완전히 무시한 경우)
        // 또는 특정 영어 시작 구문 제거 시도
        cleaned = cleaned.replace(/^Here is.*?summary:\s*/is, '');
    }

    // 2. 추가적인 영어 설명 제거 (괄호 또는 마지막 문장 등)
    cleaned = cleaned.replace(/\(Translation\).*/is, '');
    cleaned = cleaned.replace(/\(Note:.*?\)/is, '');
    cleaned = cleaned.replace(/Let me know if you.*?help.*?/is, ''); // 마지막 영어 문장 제거

    // 3. `- ):` 또는 `- :` 같은 패턴 및 `•` 제거
    cleaned = cleaned.replace(/-\s*[:\)\s]+/g, '- ');
    cleaned = cleaned.replace(/^- • /, '- ');

    // 4. 불필요한 앞뒤 공백 제거
    cleaned = cleaned.trim();

    // 5. 첫 글자가 '-'가 아니면 앞에 '-' 추가 (일관성)
    if (!cleaned.startsWith('-') && cleaned.length > 0) {
        cleaned = '- ' + cleaned;
    }

    return cleaned;
}

const port = 8080;
server.listen(port, () => {
    console.log(`[Server] Server is running on http://localhost:${port}`);
});