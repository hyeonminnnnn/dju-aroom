//C:\Program Files\WindowsApps\ngrok.ngrok_3.24.0.0_x64__1g87z0zv29zzc
//터미널 열고 ngrok http 8080
//Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
'use strict';

const localVideo = document.getElementById('localVideo');
const localVideoWrapper = document.getElementById('local-video-wrapper');
const videosContainer = document.getElementById('videos-container');
const roomCodeDisplay = document.getElementById('room-code-display');
const micBtn = document.getElementById('mic-btn');
const camBtn = document.getElementById('cam-btn');
const endCallBtn = document.getElementById('end-call-btn');

const socket = io.connect();
const roomName = window.location.hash.substring(1);

if (roomCodeDisplay) {
    roomCodeDisplay.textContent = roomName;
}

const peers = {};
let localStream;
const audioContexts = {};
let recognition; // SpeechRecognition 객체를 저장할 변수

// 1. 내 미디어 스트림 가져오기 & 음성 인식 시작
navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    .then(stream => {
        localStream = stream;
        localVideo.srcObject = stream;
        localVideoWrapper.id = socket.id;

        startSpeakingDetection(socket.id, stream, localVideoWrapper);
        updateLayout();

        // --- Web Speech API 초기화 및 시작 ---
        try {
            // 브라우저 호환성을 위한 처리
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (SpeechRecognition) {
                recognition = new SpeechRecognition();
                recognition.continuous = true; // 끊기지 않고 계속 인식
                recognition.interimResults = false; // 중간 결과 말고 최종 결과만 받음
                recognition.lang = 'ko-KR'; // 한국어 설정

                // 음성 인식 결과가 나왔을 때
                recognition.onresult = (event) => {
                    let transcript = '';
                    // 여러 조각으로 나뉘어 들어올 수 있는 결과를 하나로 합침
                    for (let i = event.resultIndex; i < event.results.length; ++i) {
                        transcript += event.results[i][0].transcript;
                    }
                    console.log('음성 인식 결과:', transcript);
                    // 인식된 텍스트가 비어있지 않으면 서버로 전송
                    if (transcript.trim().length > 0) {
                        socket.emit('recognized text', { room: roomName, text: transcript });
                    }
                };

                // 음성 인식 중 오류 발생 시
                recognition.onerror = (event) => {
                    console.error('음성 인식 오류:', event.error);
                    // 'no-speech'(말 안 함)나 'aborted'(중단됨) 오류가 아니면 잠시 후 다시 시작 시도
                    if (event.error !== 'no-speech' && event.error !== 'aborted') {
                        // 안정성을 위해 자동 재시작은 일단 보류 (필요시 활성화)
                        // setTimeout(() => startRecognitionSafely(), 500);
                    }
                };

                // 음성 인식이 (자동으로 또는 수동으로) 종료되었을 때
                recognition.onend = () => {
                    console.log('음성 인식 종료됨. 재시작 시도...');
                    // 마이크가 켜져 있다면 자동으로 다시 시작 (긴 대화 처리)
                    startRecognitionSafely();
                };

                startRecognitionSafely(); // 인식 시작 함수 호출
                console.log('음성 인식 시작됨.');

            } else {
                console.warn('Web Speech API가 이 브라우저에서 지원되지 않습니다.');
                alert('음성 인식이 지원되지 않는 브라우저입니다.');
            }
        } catch(e) {
            console.error("SpeechRecognition 초기화 오류:", e);
        }
        // --- 여기까지 ---

        socket.emit('join room', roomName);
    })
    .catch(error => {
        console.error("Error getting media stream", error);
        alert("카메라/마이크를 가져오는 데 실패했습니다.");
    });

// 음성 인식 안전하게 시작하는 함수 (마이크 상태 확인)
function startRecognitionSafely() {
    // recognition 객체가 있고, 오디오 트랙이 활성화 상태일 때만 시작
    if (recognition && localStream && localStream.getAudioTracks()[0]?.enabled) {
        try {
            recognition.start();
        } catch (e) {
            // 이미 시작된 경우 등의 오류는 무시
            // console.warn("인식을 시작할 수 없음 (이미 시작됨?):", e.message);
        }
    } else {
        console.log("음성 인식이 시작되지 않음 (마이크 음소거 또는 미준비 상태).");
    }
}


// --- 컨트롤 버튼 이벤트 핸들러 (마이크 버튼 수정) ---
micBtn.addEventListener('click', () => {
    if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0];
        audioTrack.enabled = !audioTrack.enabled;
        if (audioTrack.enabled) {
            micBtn.innerHTML = '<i class="fas fa-microphone"></i>';
            micBtn.classList.remove('toggled-off');
            startRecognitionSafely(); // 마이크 켜면 인식 다시 시작
        } else {
            micBtn.innerHTML = '<i class="fas fa-microphone-slash"></i>';
            micBtn.classList.add('toggled-off');
            if (recognition) {
                recognition.stop(); // 마이크 끄면 인식 중지
                console.log('음성 인식 중지됨 (마이크 음소거).');
            }
        }
    }
});
// ... (캠 버튼은 이전과 동일) ...
camBtn.addEventListener('click', () => {
    if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        videoTrack.enabled = !videoTrack.enabled;
        if (videoTrack.enabled) {
            camBtn.innerHTML = '<i class="fas fa-video"></i>';
            camBtn.classList.remove('toggled-off');
        } else {
            camBtn.innerHTML = '<i class="fas fa-video-slash"></i>';
            camBtn.classList.add('toggled-off');
        }
    }
});

endCallBtn.addEventListener('click', () => {
    // --- 음성 인식 중지 ---
    if (recognition) {
        recognition.abort(); // 즉시 중단
        console.log('음성 인식 중단됨 (통화 종료).');
    }
    // --- 여기까지 ---
    window.location.href = '/';
});

// 페이지 이탈 시
window.addEventListener('beforeunload', () => {
    // --- 음성 인식 중지 ---
    if (recognition) {
        recognition.abort();
    }
    // --- 여기까지 ---
    socket.disconnect();
});

// --- WebRTC 연결 로직 ---
socket.on('existing users', (otherUsers) => {
    if (!localStream) return;
    otherUsers.forEach(userId => {
        peers[userId] = createPeer(userId, socket.id, localStream);
    });
    updateLayout();
});
socket.on('user joined', (userId) => {
    if (!localStream) return;
    peers[userId] = addPeer(userId, socket.id, localStream);
    updateLayout();
});
socket.on('signal', (data) => {
    const peer = peers[data.from];
    if (peer) {
        peer.signal(data.signal);
    }
});
socket.on('user left', (userId) => {
    if (peers[userId]) {
        peers[userId].destroy();
        delete peers[userId];
    }
    const videoWrapper = document.getElementById(userId);
    if (videoWrapper) {
        videoWrapper.remove();
    }
    if (audioContexts[userId] && audioContexts[userId].state !== 'closed') {
        audioContexts[userId].close().catch(e => console.error("Error closing audio context", e));
        delete audioContexts[userId];
    }
    updateLayout();
});

function createPeer(userToSignal, callerId, stream) {
    const peer = new SimplePeer({ initiator: true, trickle: false, stream: stream });
    peer.on('signal', signal => socket.emit('signal', { to: userToSignal, from: callerId, signal }));
    peer.on('stream', remoteStream => addRemoteVideo(userToSignal, remoteStream));
    return peer;
}

function addPeer(incomingUser, callerId, stream) {
    const peer = new SimplePeer({ initiator: false, trickle: false, stream: stream });
    peer.on('signal', signal => socket.emit('signal', { to: incomingUser, from: callerId, signal }));
    peer.on('stream', remoteStream => addRemoteVideo(incomingUser, remoteStream));
    return peer;
}

// --- 동적 UI 생성 ---
function addRemoteVideo(userId, stream) {
    if (document.getElementById(userId)) return;
    const participantCount = document.querySelectorAll('.video-wrapper').length; // '나' 포함
    const wrapper = createVideoWrapper(userId, `참여자 ${participantCount + 1}`);
    const remoteVideo = wrapper.querySelector('video');
    remoteVideo.srcObject = stream;
    startSpeakingDetection(userId, stream, wrapper);
}

function createVideoWrapper(userId, name) {
    const wrapper = document.createElement('div');
    wrapper.id = userId;
    wrapper.className = 'video-wrapper';

    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;

    const userName = document.createElement('span');
    userName.className = 'user-name';
    userName.textContent = name;

    wrapper.appendChild(video);
    wrapper.appendChild(userName);

    // 내 비디오는 HTML에 이미 있으므로, 다른 사람 비디오만 추가
    if (userId !== socket.id) {
        videosContainer.appendChild(wrapper);
    }

    return wrapper;
}


// --- 레이아웃 동적 업데이트 ---
function updateLayout() {
    // CSS Grid가 자동으로 레이아웃을 처리
}

// --- 말하기 감지 기능 ---
function startSpeakingDetection(userId, stream, wrapper) {
    if (!stream.getAudioTracks().length) return;
    if (audioContexts[userId] && audioContexts[userId].state !== 'closed') {
        audioContexts[userId].close().catch(()=>{});
    }
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    audioContexts[userId] = audioContext;
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.minDecibels = -70;
    analyser.smoothingTimeConstant = 0.3;
    source.connect(analyser);
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    let speaking = false;
    const threshold = 30;
    function checkVolume() {
        if (!document.body.contains(wrapper) || audioContext.state === 'closed') return;
        analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
        const isMuted = !stream.getAudioTracks()[0]?.enabled;
        if (!isMuted && average > threshold) {
            if (!speaking) {
                speaking = true;
                wrapper.classList.add('speaking');
            }
        } else {
            if (speaking) {
                speaking = false;
                wrapper.classList.remove('speaking');
            }
        }
        requestAnimationFrame(checkVolume);
    };
    checkVolume();
}

// 창 크기가 변경될 때마다 레이아웃 업데이트
window.addEventListener('resize', updateLayout);