import { Alert, Button } from 'antd';
import { useRegisterSW } from 'virtual:pwa-register/react';

import { useMutationInFlight } from '@client/lib/request-activity';

export function PwaUpdatePrompt() {
  const mutationInFlight = useMutationInFlight();
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({ immediate: true });

  if (!needRefresh) return null;

  return (
    <Alert
      className="pwa-update-banner"
      type="info"
      showIcon
      title="Có phiên bản Pro POS mới"
      description={
        mutationInFlight
          ? 'Đang hoàn tất thao tác hiện tại. Bạn có thể cập nhật ngay khi thao tác kết thúc.'
          : 'Bấm cập nhật khi bạn đã lưu xong nội dung đang thao tác.'
      }
      action={
        <Button
          type="primary"
          size="small"
          disabled={mutationInFlight}
          onClick={() => void updateServiceWorker(true)}
        >
          Cập nhật
        </Button>
      }
      closable
      onClose={() => setNeedRefresh(false)}
    />
  );
}
