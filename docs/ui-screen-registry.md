# UI screen registry

Không có mẫu thì không triển khai visual cuối. Mẫu được người dùng gửi theo từng màn hình.

| Screen             | Reference                                                                                            | States covered                | Responsive     | Status      | Approved PR |
| ------------------ | ---------------------------------------------------------------------------------------------------- | ----------------------------- | -------------- | ----------- | ----------- |
| Bootstrap/entry    | User-provided login layout, adapted to Pro POS and `#0D7CFF`                                         | default/connection error      | desktop/mobile | IMPLEMENTED | PRO-004     |
| Owner login        | Approved auth layout; Cloudflare Access email OTP                                                    | idle/submitting/error         | desktop/mobile | IMPLEMENTED | PRO-007     |
| POS activation     | Approved auth layout; Access OTP then device name                                                    | authorize/confirm/error       | desktop/mobile | IMPLEMENTED | PRO-007     |
| Employee PIN       | Approved auth layout; username/PIN and ACTIVE-device gate                                            | inactive/active/revoked/error | desktop/mobile | IMPLEMENTED | PRO-004     |
| Platform login     | Approved auth layout; Cloudflare Access email OTP                                                    | idle/submitting/error         | desktop/mobile | IMPLEMENTED | PRO-007     |
| SUPER_ADMIN        | User-authorized simple Ant Design dashboard                                                          | empty/list/create/lock/error  | desktop/mobile | IMPLEMENTED | PRO-007     |
| Owner portal shell | User-provided Owner dashboard + Sapo sidebar interaction reference, adapted to Pro POS and `#0975F7` | loading/ready/403/expired     | desktop/mobile | IN_PROGRESS | PRO-010     |
| POS tables/orders  | Chưa nhận                                                                                            | Chưa chốt                     | Chưa chốt      | BLOCKED     | —           |
| Checkout/receipt   | Chưa nhận                                                                                            | Chưa chốt                     | Chưa chốt      | BLOCKED     | —           |

Mỗi PR UI phải đính kèm reference, screenshot triển khai và xác nhận visual trước merge `dev`.
