# Secret rotation

- Secrets: `AUTH_PEPPER`, `DEVICE_TOKEN_PEPPER`, `SESSION_TOKEN_PEPPER`,
  `SYSTEM_BOOTSTRAP_SECRET`.
- Không truyền secret trong command argument/log; dùng Wrangler interactive secret input.
- Credential rows lưu pepper/credential version để hỗ trợ nâng cấp.
- Rotate session/device pepper cần revoke/reissue các token liên quan.
- Rotate auth pepper buộc reset hoặc rehash theo kế hoạch có version; không đổi đột ngột.
