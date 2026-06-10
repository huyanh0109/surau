const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const PORT = 4747;
const RECORDINGS_DIR = path.join(__dirname, 'recordings');

// Hàm tìm đường dẫn FFmpeg trong thư mục Winget hoặc hệ thống
function getFFmpegPath() {
    try {
        // Thử chạy ffmpeg mặc định (nếu hệ thống đã nhận PATH)
        execSync('ffmpeg -version', { stdio: 'ignore' });
        return 'ffmpeg';
    } catch (e) {
        // Thử tìm trong các đường dẫn của Winget
    }

    const userProfile = process.env.USERPROFILE || 'C:\\Users\\huyan';
    
    // Đường dẫn chính xác đã phát hiện trên máy user
    const directPath = path.join(
        userProfile,
        'AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg.Essentials_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1.1-essentials_build\\bin\\ffmpeg.exe'
    );
    if (fs.existsSync(directPath)) {
        return directPath;
    }

    // Quét tìm kiếm chung trong thư mục WinGet Packages đề phòng version thay đổi
    try {
        const packagesDir = path.join(userProfile, 'AppData\\Local\\Microsoft\\WinGet\\Packages');
        if (fs.existsSync(packagesDir)) {
            const files = fs.readdirSync(packagesDir);
            for (const file of files) {
                if (file.toLowerCase().includes('ffmpeg')) {
                    const searchPath = path.join(packagesDir, file);
                    const subFiles = fs.readdirSync(searchPath);
                    for (const subFile of subFiles) {
                        const ffmpegExe = path.join(searchPath, subFile, 'bin\\ffmpeg.exe');
                        if (fs.existsSync(ffmpegExe)) {
                            return ffmpegExe;
                        }
                    }
                }
            }
        }
    } catch (err) {
        // Bỏ qua lỗi quét
    }

    return 'ffmpeg'; // fallback cuối cùng
}

const FFMPEG_PATH = getFFmpegPath();

// Tạo thư mục recordings nếu chưa tồn tại
if (!fs.existsSync(RECORDINGS_DIR)) {
    fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
}

let isRecording = false;
let ffmpegProcess = null;
let currentOutputFile = '';
let lastKeyPressTime = 0;

console.clear();
console.log('\x1b[36m========================================================\x1b[0m');
console.log('\x1b[36m             XSURAU CAMERA RECORDER & CROPPER           \x1b[0m');
console.log('\x1b[36m========================================================\x1b[0m');
console.log(`[*] Thư mục lưu video: ${RECORDINGS_DIR}`);
console.log(`[*] FFmpeg Path: ${FFMPEG_PATH}`);
console.log('[*] Đang thiết lập kết nối ADB...');

try {
    // Đảm bảo ADB đã forward port 4747
    execSync(`adb forward tcp:${PORT} tcp:${PORT}`);
    console.log(`\x1b[32m[OK] Đã forward port ${PORT} -> điện thoại qua ADB.\x1b[0m`);
} catch (e) {
    console.log('\x1b[33m[!] Cảnh báo: Không thể chạy adb forward. Đảm bảo điện thoại đã kết nối USB.\x1b[0m');
}

console.log('\x1b[35m--------------------------------------------------------\x1b[0m');
console.log(' 👉 Nhấn phím [SPACE] (Khoảng trắng) hoặc [ENTER] để BẮT ĐẦU QUAY.');
console.log(' 👉 Nhấn tiếp [SPACE] hoặc [ENTER] để DỪNG và LƯU.');
console.log(' 👉 Nhấn [Q] hoặc [Ctrl+C] để THOÁT.');
console.log('\x1b[35m--------------------------------------------------------\x1b[0m');

// Đăng ký sự kiện lắng nghe bàn phím
readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
}

process.stdin.on('keypress', (str, key) => {
    if (!key) return;
    
    // Thoát chương trình
    if ((key.ctrl && key.name === 'c') || key.name === 'q') {
        if (isRecording) {
            stopRecording(true); // dừng đột ngột
        }
        console.log('\n[*] Đang thoát chương trình. Tạm biệt!');
        process.exit();
    }

    // Nhấn Space hoặc Enter (chống kích đúp hoặc nhấp phím quá nhanh)
    if (key.name === 'space' || key.name === 'return') {
        const now = Date.now();
        if (now - lastKeyPressTime < 600) {
            return; // bỏ qua nếu nhấn quá nhanh trong 600ms
        }
        lastKeyPressTime = now;

        if (!isRecording) {
            startRecording();
        } else {
            stopRecording(false);
        }
    }
});

function startRecording(attempt = 1) {
    isRecording = true;
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const timestamp = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    
    currentOutputFile = path.join(RECORDINGS_DIR, `camera_${timestamp}.mp4`);
    const deviceName = attempt === 1 ? 'DroidCam Source 3' : 'DroidCam Source 2';

    console.log(`\n\x1b[32m[● RECORDING] Đang quay từ webcam "${deviceName}"... Nhấn [SPACE]/[ENTER] để dừng.\x1b[0m`);
    console.log(`\x1b[90m[File] ${currentOutputFile}\x1b[0m`);

    // Chạy ffmpeg để bắt luồng video từ Driver DirectShow của DroidCam trên PC
    ffmpegProcess = spawn(FFMPEG_PATH, [
        '-y',
        '-f', 'dshow',
        '-i', `video=${deviceName}`,
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-tune', 'zerolatency',
        '-an', // Tắt tiếng
        currentOutputFile
    ]);

    let stderrOutput = '';
    ffmpegProcess.stderr.on('data', (data) => {
        stderrOutput += data.toString();
    });

    ffmpegProcess.on('error', (err) => {
        console.error(`\x1b[31m[Lỗi] Không thể khởi chạy FFmpeg: ${err.message}\x1b[0m`);
        isRecording = false;
        ffmpegProcess = null;
    });

    ffmpegProcess.on('close', (code) => {
        if (isRecording) {
            if (attempt === 1 && code !== 0) {
                // Thử lại với DroidCam Source 2 nếu Source 3 lỗi
                startRecording(2);
                return;
            }
            console.log(`\x1b[31m[!] FFmpeg đã dừng đột ngột với mã thoát ${code}.\x1b[0m`);
            if (code !== 0) {
                console.log(`\x1b[90m[Chi tiết lỗi FFmpeg]\n${stderrOutput.slice(-300)}\x1b[0m`);
            }
        }
        isRecording = false;
        ffmpegProcess = null;
    });
}

function stopRecording(force = false) {
    if (!ffmpegProcess) return;

    console.log(`\n\x1b[33m[*] Đang dừng ghi hình và đóng file video...\x1b[0m`);

    if (force) {
        ffmpegProcess.kill('SIGINT');
        console.log(`\x1b[31m[!] Đã dừng đột ngột.\x1b[0m`);
    } else {
        // Gửi phím 'q' vào tiến trình ffmpeg để lưu file MP4 chuẩn
        ffmpegProcess.stdin.write('q');
    }

    // Chờ 1 giây để ffmpeg hoàn tất đóng file
    setTimeout(() => {
        if (fs.existsSync(currentOutputFile)) {
            const stats = fs.statSync(currentOutputFile);
            const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
            console.log(`\x1b[32m[✓ SAVED] Đã lưu video thành công!\x1b[0m`);
            console.log(`\x1b[32m[Đường dẫn] ${currentOutputFile} (${sizeMB} MB)\x1b[0m`);
        } else {
            console.log(`\x1b[31m[Lỗi] Không tìm thấy file video đầu ra.\x1b[0m`);
        }
        console.log('\x1b[35m--------------------------------------------------------\x1b[0m');
        console.log(' 👉 Nhấn [SPACE]/[ENTER] để quay đoạn mới.');
    }, 1000);
}
