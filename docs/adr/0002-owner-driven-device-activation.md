# ADR-0002: Owner-driven POS activation

Status: Accepted

Owner direct login không yêu cầu device. POS activation dùng dedicated Owner re-auth, grant 5 phút
scope `ACTIVATE_DEVICE`, sau đó confirm/idempotency tạo device credential. Grant không thay thế
username/password và không tạo Owner session. Employee PIN luôn yêu cầu device `ACTIVE`.
