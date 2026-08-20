import { Alert, Button, Flex, Result, Spin, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, Route, Routes } from 'react-router';

import type { AuthContextResponse } from '@contracts/auth';

import { apiRequest } from './lib/api';

function BootstrapPage() {
  const context = useQuery({
    queryKey: ['auth-context'],
    queryFn: () => apiRequest<AuthContextResponse>('/api/v1/auth/context'),
  });

  if (context.isLoading) {
    return <Spin fullscreen description="Đang kiểm tra phiên đăng nhập và thiết bị" />;
  }

  if (context.isError || !context.data) {
    return (
      <Result
        status="error"
        title="Không thể kết nối Pro POS"
        subTitle="Vui lòng kiểm tra kết nối mạng và thử lại."
      />
    );
  }

  const data = context.data;

  if (data.actor?.kind === 'OWNER') {
    return <Navigate to="/owner" replace />;
  }

  if (data.actor?.kind === 'EMPLOYEE' && data.device?.status === 'ACTIVE') {
    return <Navigate to="/pos" replace />;
  }

  return (
    <main className="app-shell">
      <Typography.Title level={1}>Pro POS</Typography.Title>
      {data.device?.status === 'REVOKED' ? (
        <Alert
          type="warning"
          showIcon
          message="Thiết bị POS đã bị thu hồi"
          description="Chủ cửa hàng vẫn có thể đăng nhập quản trị hoặc thiết lập lại thiết bị."
        />
      ) : null}
      <Flex vertical gap="middle">
        <Link to="/owner/login">
          <Button type="primary" block>
            Đăng nhập Chủ cửa hàng
          </Button>
        </Link>
        {data.device?.status === 'ACTIVE' ? (
          <Link to="/pos/login">
            <Button block>Nhân viên</Button>
          </Link>
        ) : (
          <Link to="/device-activation">
            <Button block>Thiết lập làm máy POS</Button>
          </Link>
        )}
      </Flex>
      <Typography.Paragraph type="secondary" className="ui-reference-note">
        Giao diện đang ở trạng thái khung chức năng. Visual cuối chỉ được triển khai sau khi có mẫu
        tham khảo được duyệt.
      </Typography.Paragraph>
    </main>
  );
}

function PlaceholderPage({ title }: { title: string }) {
  return (
    <main className="app-shell">
      <Typography.Title level={1}>{title}</Typography.Title>
      <Alert
        type="info"
        message="Đang chờ mẫu UI tham khảo"
        description="Contract và backend được triển khai trước; visual không được tự suy đoán."
      />
      <Link to="/">Quay lại</Link>
    </main>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<BootstrapPage />} />
      <Route path="/owner/login" element={<PlaceholderPage title="Đăng nhập Chủ cửa hàng" />} />
      <Route path="/device-activation" element={<PlaceholderPage title="Thiết lập máy POS" />} />
      <Route path="/pos/login" element={<PlaceholderPage title="Đăng nhập Nhân viên" />} />
      <Route path="/owner/*" element={<PlaceholderPage title="Cổng Chủ cửa hàng" />} />
      <Route path="/pos/*" element={<PlaceholderPage title="Cổng Nhân viên" />} />
      <Route path="/platform/*" element={<PlaceholderPage title="Cổng SUPER_ADMIN" />} />
      <Route path="*" element={<Result status="404" title="Không tìm thấy trang" />} />
    </Routes>
  );
}
