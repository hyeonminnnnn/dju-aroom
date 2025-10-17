'use strict';

const createRoomBtn = document.querySelector('#create-room-btn');
const joinRoomForm = document.querySelector('#join-room-form');
const downloadLogBtn = document.querySelector('#download-log-btn');
const modalBackdrop = document.querySelector('#modal-backdrop');
const downloadModal = document.querySelector('#download-modal');
const modalCloseBtn = document.querySelector('#modal-close-btn');
const downloadForm = document.querySelector('#download-form');
const modalRoomCodeInput = document.querySelector('#modal-room-code-input');

const socket = io.connect();

createRoomBtn.addEventListener('click', () => {
    const roomCode = Math.floor(100000 + Math.random() * 900000).toString();
    window.location.href = `room.html#${roomCode}`;
});

joinRoomForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const roomCodeInput = document.querySelector('#room-code-input');
    const enteredCode = roomCodeInput.value.trim();
    if (enteredCode) {
        window.location.href = `room.html#${enteredCode}`;
    }
});

// --- 모달 제어 ---
downloadLogBtn.addEventListener('click', () => {
    modalBackdrop.classList.remove('hidden');
});

modalCloseBtn.addEventListener('click', () => {
    modalBackdrop.classList.add('hidden');
});

modalBackdrop.addEventListener('click', (e) => {
    if (e.target === modalBackdrop) {
        modalBackdrop.classList.add('hidden');
    }
});

// --- 다운로드 폼 제출 ---
downloadForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const roomCode = modalRoomCodeInput.value.trim();
    if (roomCode.length === 6) {
        socket.emit('get summary', roomCode);
        modalBackdrop.classList.add('hidden');
        modalRoomCodeInput.value = '';
    } else {
        alert('6자리 회의방 번호를 정확히 입력해주세요.');
    }
});

// --- 서버로부터 요약본 수신 ---
socket.on('summary received', ({ roomCode, summaryText }) => {
    if (summaryText.startsWith('해당 회의방') || summaryText.startsWith('회의가 종료된 지')) {
        alert(summaryText); // 오류 메시지 표시
    } else {
        downloadSummary(roomCode, summaryText);
        alert('회의록 다운로드를 시작합니다.');
    }
});

// --- 텍스트 파일 다운로드 함수 ---
function downloadSummary(roomCode, text) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `회의록_${roomCode}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
}