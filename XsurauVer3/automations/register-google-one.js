const { sleep } = require('./helpers');

/**
 * Tự động đăng ký Google One 2TB AI Premium
 */
async function run(page, job, signal, logger) {
    const log = (msg) => { logger?.(msg); console.log(`[P${job.profileId}] ${msg}`); };
    try {
        if (signal?.aborted) return { profileId: job.profileId, success: false, error: 'Stopped' };

        log('Tiêm Mock Bridge (GoogleOneBridge) vào trình duyệt...');
        
        let paymentUrl = null;

        // Force User-Agent Mobile để chắc chắn Google hiển thị bản Mobile
        await page.setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 10 Pro XL Build/UP1A.231005.007) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.6167.164 Mobile Safari/537.36', {
            architecture: "",
            bitness: "",
            brands: [{ brand: "Not A(Brand", version: "99" }, { brand: "Google Chrome", version: "121" }, { brand: "Chromium", version: "121" }],
            fullVersionList: [{ brand: "Google Chrome", version: "121.0.6167.164" }],
            mobile: true,
            model: "Pixel 10 Pro XL",
            platform: "Android",
            platformVersion: "14.0.0"
        });
        await page.setViewportSize({ width: 412, height: 915 });

        // 1. Expose function để nhận SKU từ Client-side JS
        await page.exposeFunction('captureGoogleBilling', (payload) => {
            log(`[Mock Bridge] Nhận được payload từ Google: ${payload.substring(0, 50)}...`);
            try {
                // Thường payload có dạng chuỗi mã hóa, hoặc JSON, nhưng ta dùng regex rút thẳng SKU "google_one_2tb_ai_premium"
                const skuMatch = payload.match(/(google_one_[^"'\\]+)/);
                if (skuMatch) {
                    const sku = skuMatch[1];
                    log(`🎉 Bắt được mã SKU: ${sku}`);
                    // Ghép URL thanh toán Google Play Web chuẩn
                    paymentUrl = `https://play.google.com/store/buy/payment/dialog?sku=${sku}&resourceId=0`;
                } else if (payload.includes('play.google.com/store/buy')) {
                     // Đôi khi payload đã chứa URL hoàn chỉnh
                     const urlMatch = payload.match(/(https:\/\/play\.google\.com\/store\/buy[^"'\\]+)/);
                     if (urlMatch) paymentUrl = urlMatch[1];
                }
            } catch (e) {
                log(`Lỗi parse payload: ${e.message}`);
            }
        });

        // 2. Tiêm Script vào trang web
        // Đảm bảo script được đưa vào ngay trước khi trang load xong DOM
        await page.addInitScript(() => {
            // Giả lập giao diện Android Native (Cầu nối Play Store)
            window.GoogleOneBridge = {
                postMessage: function(msg) {
                    window.captureGoogleBilling(msg);
                }
            };
            window.AndroidPayment = {
                postMessage: function(msg) {
                    window.captureGoogleBilling(msg);
                }
            };
            
            // Ép Client Hints báo đây là Pixel 10 Pro XL (Bảo vệ Xsurau)
            if (navigator.userAgentData) {
                const originalGet = navigator.userAgentData.getHighEntropyValues.bind(navigator.userAgentData);
                navigator.userAgentData.getHighEntropyValues = async (hints) => {
                    const res = await originalGet(hints);
                    res.model = "Pixel 10 Pro XL";
                    res.platform = "Android";
                    res.platformVersion = "14.0.0";
                    res.mobile = true;
                    return res;
                };
            }
        });

        if (signal?.aborted) return { profileId: job.profileId, success: false, error: 'Stopped' };

        // 3. Mở trang Upsell Google One
        log('Đang truy cập Google One Upsell...');
        await page.goto('https://one.google.com/upsell?hide_ogb=true&dm=true', { waitUntil: 'networkidle', timeout: 30000 });
        await sleep(5000); // Đợi thêm chút cho UI load hẳn

        // 4. Bấm "Start Trial"
        log('Tìm nút Bắt đầu dùng thử (Start trial)...');
        const clicked = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button, a, div[role="button"]'));
            const btn = btns.find(b => 
                b.textContent?.toLowerCase().includes('start trial') || 
                b.textContent?.toLowerCase().includes('bắt đầu dùng thử') ||
                b.textContent?.toLowerCase().includes('bắt đầu bản dùng thử') ||
                b.textContent?.toLowerCase().includes('ai premium') ||
                b.textContent?.toLowerCase().includes('claim') ||
                b.textContent?.toLowerCase().includes('dùng thử')
            );
            if (btn) {
                btn.click();
                return true;
            }
            return false;
        });

        if (!clicked) {
            return { profileId: job.profileId, success: false, error: 'Không tìm thấy nút Start Trial (Thiết bị chưa nhận dạng Pixel hoặc Hết hạn ưu đãi)' };
        }

        log('Đã bấm Start Trial. Đang chờ phản hồi từ cầu nối Google Play...');
        
        // 5. Đợi hàm exposeFunction bắt được URL (10 giây)
        for (let i = 0; i < 20; i++) {
            if (paymentUrl) break;
            await sleep(500);
        }

        if (!paymentUrl) {
            return { profileId: job.profileId, success: false, error: 'Không bắt được URL thanh toán Play Store qua postMessage' };
        }

        if (signal?.aborted) return { profileId: job.profileId, success: false, error: 'Stopped' };

        // 6. Mở trang thanh toán Play Store Web
        log(`Mở popup thanh toán Play Store Web: ${paymentUrl}`);
        await page.goto(paymentUrl, { waitUntil: 'networkidle', timeout: 30000 });
        await sleep(6000); // Đợi iframe thanh toán render xong

        // 7. Click nút "Subscribe" / "Đăng ký"
        log('Đang xác nhận thanh toán (0đ)...');
        const subscribed = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button, div[role="button"]'));
            const subBtn = btns.find(b => 
                b.textContent?.toLowerCase().includes('subscribe') || 
                b.textContent?.toLowerCase().includes('đăng ký') ||
                b.textContent?.toLowerCase().includes('nhận ưu đãi') ||
                b.textContent?.toLowerCase().includes('claim')
            );
            if (subBtn) {
                subBtn.click();
                return true;
            }
            return false;
        });

        if (!subscribed) {
            log('⚠️ Không tìm thấy nút Subscribe. Có thể yêu cầu Add thẻ tín dụng (Visa/Mastercard).');
            return { profileId: job.profileId, success: false, error: 'Lỗi Checkout: Yêu cầu Add Thẻ hoặc Không tải được form thanh toán' };
        }

        await sleep(5000);
        log('✅ Hoàn tất quá trình đăng ký Google One 2TB AI Premium!');
        
        return { 
            profileId: job.profileId, 
            success: true, 
            data: { message: 'Đăng ký Google One thành công' } 
        };

    } catch (error) {
        log(`❌ Lỗi: ${error.message}`);
        return { profileId: job.profileId, success: false, error: error.message };
    }
}

module.exports = { name: 'register-google-one', run };
