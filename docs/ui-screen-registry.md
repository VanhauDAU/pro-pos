# UI screen registry

Không có mẫu thì không triển khai visual cuối. Mẫu được người dùng gửi theo từng màn hình.

| Screen               | Reference                                                                                            | States covered                                    | Responsive            | Status      | Approved PR |
| -------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------- | ----------- | ----------- |
| Bootstrap/entry      | User-provided login layout, adapted to Pro POS and `#0D7CFF`                                         | default/connection error                          | desktop/mobile        | IMPLEMENTED | PRO-004     |
| Owner login          | Approved auth layout; Cloudflare Access email OTP                                                    | idle/submitting/error                             | desktop/mobile        | IMPLEMENTED | PRO-007     |
| POS activation       | Approved auth layout; Access OTP then device name                                                    | authorize/confirm/error                           | desktop/mobile        | IMPLEMENTED | PRO-007     |
| Employee PIN         | Approved auth layout; username/PIN and ACTIVE-device gate                                            | inactive/active/revoked/error                     | desktop/mobile        | IMPLEMENTED | PRO-004     |
| Platform login       | Approved auth layout; Cloudflare Access email OTP                                                    | idle/submitting/error                             | desktop/mobile        | IMPLEMENTED | PRO-007     |
| SUPER_ADMIN          | User-authorized simple Ant Design dashboard                                                          | empty/list/create/lock/error                      | desktop/mobile        | IMPLEMENTED | PRO-007     |
| Owner portal shell   | User-provided Owner dashboard + Sapo sidebar interaction reference, adapted to Pro POS and `#0975F7` | loading/ready/403/expired                         | desktop/mobile        | IN_PROGRESS | PRO-010     |
| Owner store settings | User-provided Sapo settings form reference, adapted to Pro POS                                       | loading/edit/saving/error                         | desktop/tablet/mobile | IN_PROGRESS | PRO-010     |
| Owner product list   | User-provided Sapo product list reference, selected MVP fields                                       | loading/list/search/empty/error                   | desktop/tablet/mobile | IN_PROGRESS | PRO-013     |
| Owner product form   | User-provided Sapo add/edit product reference, selected MVP fields                                   | create/edit/special-hours/upload/validation/error | desktop/tablet/mobile | IN_PROGRESS | PRO-015     |
| Owner category list  | User-provided Sapo category list reference, selected MVP fields                                      | loading/list/search/empty/error                   | desktop/tablet/mobile | IN_PROGRESS | PRO-013     |
| Owner unit list      | User-provided unit settings reference, only unit and product usage columns                           | loading/list/search/empty/error                   | desktop/tablet/mobile | IN_PROGRESS | PRO-014     |
| Owner unit detail    | User-provided unit edit reference, product usage list and safe delete                                | loading/edit/pagination/error                     | desktop/tablet/mobile | IN_PROGRESS | PRO-014     |
| POS tables/orders    | Chưa nhận                                                                                            | Chưa chốt                                         | Chưa chốt             | BLOCKED     | —           |
| Checkout/receipt     | Chưa nhận                                                                                            | Chưa chốt                                         | Chưa chốt             | BLOCKED     | —           |

Mỗi PR UI phải đính kèm reference, screenshot triển khai và xác nhận visual trước merge `dev`.
