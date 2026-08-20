# UI screen registry

Không có mẫu thì không triển khai visual cuối. Mẫu được người dùng gửi theo từng màn hình.

| Screen            | Reference                                                    | States covered                | Responsive     | Status      | Approved PR |
| ----------------- | ------------------------------------------------------------ | ----------------------------- | -------------- | ----------- | ----------- |
| Bootstrap/entry   | User-provided login layout, adapted to Pro POS and `#0D7CFF` | default/connection error      | desktop/mobile | IMPLEMENTED | PRO-004     |
| Owner login       | Approved auth layout; username/password                      | idle/submitting/error         | desktop/mobile | IMPLEMENTED | PRO-004     |
| POS activation    | Derived from approved auth layout; explanatory two-step flow | authorize/confirm/error       | desktop/mobile | IMPLEMENTED | PRO-004     |
| Employee PIN      | Approved auth layout; username/PIN and ACTIVE-device gate    | inactive/active/revoked/error | desktop/mobile | IMPLEMENTED | PRO-004     |
| Owner portal      | Chưa nhận                                                    | Chưa chốt                     | Chưa chốt      | BLOCKED     | —           |
| POS tables/orders | Chưa nhận                                                    | Chưa chốt                     | Chưa chốt      | BLOCKED     | —           |
| Checkout/receipt  | Chưa nhận                                                    | Chưa chốt                     | Chưa chốt      | BLOCKED     | —           |

Mỗi PR UI phải đính kèm reference, screenshot triển khai và xác nhận visual trước merge `dev`.
