# ADR-0002: Owner-driven POS activation

Status: Accepted, amended by ADR-0005

Owner direct login không yêu cầu device. POS activation dùng dedicated Owner authentication, grant
5 phút scope `ACTIVATE_DEVICE`, sau đó confirm/idempotency tạo device credential. Grant không thay
thế Cloudflare Access email OTP và không tạo Owner session. Employee PIN luôn yêu cầu device
`ACTIVE`.
