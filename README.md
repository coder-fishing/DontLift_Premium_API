# DontLift Premium API

Express backend cho mua Premium bằng payOS, dùng Firestore hiện tại trên Spark. Node 24; không Firebase Functions hoặc database thứ hai.

## Chạy

Tại thư mục `premium-api`, chạy `pnpm install`, bảo đảm `.env` có các biến cấu hình backend bên dưới, rồi chạy `pnpm dev` để mở API local tại `http://localhost:3000` (hoặc cổng trong `PORT`). `pnpm start` chạy tương tự nhưng không tự reload khi sửa code. `npm ci` / `npm start` cũng được hỗ trợ. `pnpm test` chạy tests; Firestore integration được skip khi chưa có emulator.

API local vẫn cần Firebase service account và credentials payOS hợp lệ để khởi động. `PUBLIC_BASE_URL` hiện phải là HTTPS origin vì URL này được gửi cho payOS làm return/cancel URL; khi chỉ thử endpoint local, dùng HTTPS origin của môi trường backend đã deploy. Webhook payOS không thể gọi trực tiếp `localhost`; để kiểm thử webhook local cần một URL HTTPS có thể truy cập từ Internet.

Các biến backend:

| Biến | Giá trị |
|---|---|
| PUBLIC_BASE_URL | HTTPS origin của host Express, không có path/query |
| FIREBASE_PROJECT_ID | Project Firebase của app |
| FIREBASE_SERVICE_ACCOUNT_PATH | Đường dẫn file JSON service account local; không Git/app |
| FIREBASE_SERVICE_ACCOUNT_JSON | JSON service account cho secret store trên host; không Git/app |
| PAYOS_CLIENT_ID / PAYOS_API_KEY / PAYOS_CHECKSUM_KEY | Ba credentials của một payOS payment channel |
| PORT | Host cấp hoặc mặc định 3000 |
| WEB_ORIGIN | Optional allowlisted web origin; native app không cần |

Có thể dùng Application Default Credentials thay JSON khi host hỗ trợ. Local nên đặt `FIREBASE_SERVICE_ACCOUNT_PATH` trỏ tới file JSON tải từ Firebase để tránh lỗi escape trong `.env`. Service account cần quyền Firestore read/write và quyền xác minh user/token revocation Firebase Auth; cấp quyền tối thiểu theo IAM của project. Không dùng Owner key và không đưa credential vào `EXPO_PUBLIC_*`.

Trong `dontlift-mobile/.env.local`, đặt `EXPO_PUBLIC_PREMIUM_API_URL` bằng origin Express rồi restart Expo. Expo Go cần URL điện thoại truy cập được. Expo `--tunnel` chỉ expose Metro, không expose Express.

## Nối payOS

1. Tạo/xác minh tài khoản cá nhân hoặc doanh nghiệp và payment channel trên my.payos.vn.
2. Điền ba credentials vào backend secret store. Host phải truy cập được Firestore; project không cần đổi Spark sang Blaze.
3. Deploy Express với health check `/health` và HTTPS. Dockerfile có sẵn; gói free/sleep/quotas của host cần kiểm tra tại thời điểm chọn. Source không tự đăng ký tài khoản hoặc bật billing host.
4. Đăng ký webhook `${PUBLIC_BASE_URL}/webhooks/payos` trong payOS. Probe đã ký được nhận mà không tạo Premium.
5. Return/cancel pages được backend phục vụ tại `/checkout/return` và `/checkout/cancel`. Quay về browser không tự cấp Premium; mở app để kiểm tra.
6. Sau khi review/test Rules, deploy từ `dontlift-mobile/functions`: `pnpm exec firebase deploy --config ../firebase.json --only firestore:rules --project august-monument-508716-u0`. Đây chỉ deploy Rules, không deploy Functions.

App sử dụng Bearer Firebase token cho `/v1/premium/orders`; amount/package ownership được backend kiểm tra. Tạo đơn dùng UUID requestId để retry không tạo payment thứ hai. Admin SDK bỏ qua Rules; credentials và endpoint auth phải được bảo vệ. Webhook xác minh chữ ký và đọc lại payment PAID bên payOS trước khi cấp entitlement trong transaction.

## Kiểm tra cục bộ

`npm test` kiểm tra calendar tháng Việt Nam, HTTP auth, chữ ký SDK, không tin redirect và provider failure. Để chạy Rules/integration, dùng Java 21+ và Firestore emulator; từ app/functions chạy emulator với demo project rồi chạy `node --test tests/premium-rules.emulator.test.cjs` và từ backend chạy `node --test test/firestore.integration.test.js`. Integration chỉ chạy khi `FIRESTORE_EMULATOR_HOST` có giá trị và `GCLOUD_PROJECT` bắt đầu `demo-`.

## Sau khi nối live

Thử merchant test environment trước: tạo đơn; hủy rồi mua lại; đóng app khi checkout; webhook trùng; gia hạn gói thứ hai; đổi account; expiry/quota. Không dùng payment thật mà không user thao tác duyệt. Chưa có host/keys thì source chạy unit tests được, nhưng checkout live chưa hoạt động.

Nếu đã trả tiền mà app vẫn pending, kiểm tra webhook delivery trong payOS và API logs; backend chỉ trả 2xx sau khi commit grant hoặc nhận duplicate/probe hợp lệ. Khi database/upstream lỗi, provider có thể retry. Giữ order documents/receipts để chống grant trùng; chưa tự xóa chúng khi D10 chưa được chốt. Không bật TTL tùy ý. Không tự động hoàn tiền hoặc hủy entitlement khi chỉ nhận redirect cancel.

Nguồn: https://payos.vn/docs/sdks/back-end/node/ và https://payos.vn/docs/api/.
