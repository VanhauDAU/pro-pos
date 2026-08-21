import {
  BellOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CreditCardOutlined,
  MinusOutlined,
  PlusOutlined,
  ShoppingCartOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Empty,
  Result,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router';

import type {
  GuestMenuProduct,
  GuestOrderContext,
  GuestOrderRequestDto,
} from '@contracts/qr-order';
import { apiRequest, jsonRequest } from '@client/lib/api';

interface CartLine {
  product: GuestMenuProduct;
  variantId: string;
  variantName: string;
  price: number;
  quantity: number;
}

function money(value: number) {
  return new Intl.NumberFormat('vi-VN').format(value) + 'đ';
}

export function GuestOrderPage() {
  const { token } = useParams<{ token: string }>();
  const queryClient = useQueryClient();
  const [messageApi, holder] = message.useMessage();
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const context = useQuery({
    queryKey: ['guest-order-context', token],
    queryFn: () => apiRequest<GuestOrderContext>(`/api/v1/guest-order/resolve/${token}`),
    enabled: Boolean(token),
    retry: false,
  });
  const requests = useQuery({
    queryKey: ['guest-order-own-requests'],
    queryFn: () => apiRequest<GuestOrderRequestDto[]>('/api/v1/guest-order/requests'),
    enabled: context.isSuccess,
    refetchInterval: 4_000,
  });

  const lines = Object.values(cart);
  const total = lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
  const categories = useMemo(
    () => [...new Set((context.data?.menu ?? []).map((p) => p.categoryName ?? 'Khác'))],
    [context.data?.menu],
  );

  const add = (product: GuestMenuProduct, variantId?: string) => {
    const variant = product.variants.find((item) => item.id === variantId) ?? product.variants[0];
    if (!variant) return;
    setCart((current) => ({
      ...current,
      [variant.id]: {
        product,
        variantId: variant.id,
        variantName: variant.name,
        price: variant.salePriceVnd,
        quantity: Math.min(20, (current[variant.id]?.quantity ?? 0) + 1),
      },
    }));
  };

  const changeQuantity = (variantId: string, delta: number) => {
    setCart((current) => {
      const line = current[variantId];
      if (!line) return current;
      const quantity = line.quantity + delta;
      if (quantity <= 0) {
        const next = { ...current };
        delete next[variantId];
        return next;
      }
      return { ...current, [variantId]: { ...line, quantity: Math.min(20, quantity) } };
    });
  };

  const submit = useMutation({
    mutationFn: async () => {
      const clientRequestId = crypto.randomUUID();
      return jsonRequest<{ requestId: string }>(
        '/api/v1/guest-order/requests',
        {
          clientRequestId,
          items: lines.map((line) => ({
            productId: line.product.id,
            variantId: line.variantId,
            quantity: line.quantity,
          })),
        },
        { headers: { 'Idempotency-Key': clientRequestId } },
      );
    },
    onSuccess: async () => {
      setCart({});
      messageApi.success('Đã gửi yêu cầu. Vui lòng chờ nhân viên xác nhận.');
      await queryClient.invalidateQueries({ queryKey: ['guest-order-own-requests'] });
    },
    onError: (error) =>
      messageApi.error(error instanceof Error ? error.message : 'Không thể gửi yêu cầu.'),
  });

  const service = useMutation({
    mutationFn: (type: 'CALL_STAFF' | 'CHECKOUT_REQUEST') =>
      jsonRequest('/api/v1/guest-order/service-requests', { type }),
    onSuccess: () => messageApi.success('Nhân viên đã nhận được yêu cầu của bạn.'),
    onError: (error) =>
      messageApi.warning(error instanceof Error ? error.message : 'Không thể gửi yêu cầu.'),
  });

  if (context.isLoading) return <Spin fullscreen description="Đang mở menu của bàn" />;
  if (context.isError || !context.data) {
    return (
      <Result
        status="warning"
        title="Không thể gọi món"
        subTitle={
          context.error instanceof Error
            ? context.error.message
            : 'Bàn chưa mở hoặc QR không còn hiệu lực.'
        }
      />
    );
  }

  return (
    <div
      style={{
        maxWidth: 720,
        margin: '0 auto',
        padding: '16px 14px 130px',
        background: '#f6f8fb',
        minHeight: '100vh',
      }}
    >
      {holder}
      <Card styles={{ body: { padding: 16 } }} style={{ marginBottom: 14 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {context.data.storeName}
        </Typography.Title>
        <Typography.Text strong style={{ color: '#0975f7' }}>
          {context.data.tableName} · {context.data.areaName}
        </Typography.Text>
      </Card>

      <Space style={{ width: '100%', marginBottom: 14 }}>
        <Button
          block
          icon={<BellOutlined />}
          onClick={() => service.mutate('CALL_STAFF')}
          loading={service.isPending}
        >
          Gọi nhân viên
        </Button>
        <Button
          block
          icon={<CreditCardOutlined />}
          onClick={() => service.mutate('CHECKOUT_REQUEST')}
          loading={service.isPending}
        >
          Yêu cầu thanh toán
        </Button>
      </Space>

      {(requests.data ?? []).slice(0, 3).map((request) => (
        <Alert
          key={request.id}
          style={{ marginBottom: 8 }}
          type={
            request.status === 'ACCEPTED'
              ? 'success'
              : request.status === 'REJECTED'
                ? 'error'
                : 'info'
          }
          showIcon
          icon={request.status === 'ACCEPTED' ? <CheckCircleOutlined /> : <ClockCircleOutlined />}
          title={
            request.status === 'PENDING'
              ? 'Đang chờ quán xác nhận'
              : request.status === 'ACCEPTED'
                ? 'Quán đã nhận món'
                : request.status === 'REJECTED'
                  ? `Quán từ chối: ${request.rejectedReason ?? ''}`
                  : request.status
          }
        />
      ))}

      {categories.map((category) => (
        <section key={category} style={{ marginTop: 20 }}>
          <Typography.Title level={4}>{category}</Typography.Title>
          <div
            style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}
          >
            {(context.data.menu ?? [])
              .filter((p) => (p.categoryName ?? 'Khác') === category)
              .map((product) => {
                const variant = product.variants[0];
                return (
                  <Card key={product.id} styles={{ body: { padding: 12 } }}>
                    <div
                      style={{
                        height: 86,
                        borderRadius: 10,
                        background: product.avatarColor ?? '#e7f1ff',
                        overflow: 'hidden',
                        marginBottom: 8,
                      }}
                    >
                      {product.mediaId ? (
                        <img
                          src={`/api/v1/guest-order/media/${product.mediaId}`}
                          alt=""
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      ) : null}
                    </div>
                    <Typography.Text strong style={{ display: 'block' }}>
                      {product.name}
                    </Typography.Text>
                    {product.variants.length > 1 ? (
                      <Select
                        size="small"
                        style={{ width: '100%', margin: '6px 0' }}
                        defaultValue={variant?.id}
                        options={product.variants.map((v) => ({
                          value: v.id,
                          label: `${v.name} · ${money(v.salePriceVnd)}`,
                        }))}
                        onChange={(id) => add(product, id)}
                      />
                    ) : (
                      <Typography.Text type="secondary">
                        {variant
                          ? `${money(variant.salePriceVnd)}${product.unitName ? ` / ${product.unitName}` : ''}`
                          : ''}
                      </Typography.Text>
                    )}
                    <Button
                      type="primary"
                      block
                      icon={<PlusOutlined />}
                      style={{ marginTop: 8 }}
                      onClick={() => add(product)}
                    >
                      Thêm
                    </Button>
                  </Card>
                );
              })}
          </div>
        </section>
      ))}

      {context.data.menu.length === 0 ? <Empty description="Quán chưa có món bán qua QR" /> : null}

      {lines.length > 0 ? (
        <Card
          style={{
            position: 'fixed',
            bottom: 10,
            left: 10,
            right: 10,
            maxWidth: 692,
            margin: '0 auto',
            zIndex: 10,
            boxShadow: '0 10px 35px rgba(15,23,42,.2)',
          }}
          styles={{ body: { padding: 12 } }}
        >
          {lines.map((line) => (
            <div
              key={line.variantId}
              style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}
            >
              <span style={{ flex: 1 }}>
                {line.product.name} <Tag>{line.variantName}</Tag>
              </span>
              <Button
                size="small"
                icon={<MinusOutlined />}
                onClick={() => changeQuantity(line.variantId, -1)}
              />
              <strong>{line.quantity}</strong>
              <Button
                size="small"
                icon={<PlusOutlined />}
                onClick={() => changeQuantity(line.variantId, 1)}
              />
            </div>
          ))}
          <Button
            type="primary"
            size="large"
            block
            icon={<ShoppingCartOutlined />}
            loading={submit.isPending}
            onClick={() => submit.mutate()}
          >
            Gọi món · {money(total)}
          </Button>
        </Card>
      ) : null}
    </div>
  );
}
