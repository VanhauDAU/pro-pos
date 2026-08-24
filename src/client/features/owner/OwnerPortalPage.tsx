import {
  AppstoreOutlined,
  BarChartOutlined,
  BellOutlined,
  ClockCircleOutlined,
  CreditCardOutlined,
  DashboardOutlined,
  FileTextOutlined,
  GiftOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MessageOutlined,
  PhoneOutlined,
  PrinterOutlined,
  QuestionCircleOutlined,
  SettingOutlined,
  ShopOutlined,
  ShoppingOutlined,
  TagsOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Avatar,
  Button,
  Card,
  ConfigProvider,
  Dropdown,
  Drawer,
  Grid,
  Layout,
  Menu,
  Spin,
  Typography,
  message,
} from 'antd';
import type { MenuProps } from 'antd';
import { lazy, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';

import type { AuthContextResponse } from '@contracts/auth';

import logo from '@client/assets/logo-white.svg';
import { apiRequest } from '@client/lib/api';

import { OwnerStoreSettingsPage } from './OwnerStoreSettingsPage';
import { OwnerAccountSettingsPage } from './OwnerAccountSettingsPage';
import { OwnerAreaCreatePage, OwnerAreaSettingsPage } from './OwnerAreaSettingsPage';
import { OwnerEmployeeFormPage, OwnerStaffListPage } from './OwnerStaffPages';
import { OwnerRoleFormPage, OwnerRolesPage } from './OwnerRolePages';
import { OwnerUnitDetailPage, OwnerUnitSettingsPage } from './OwnerUnitSettingsPage';
import {
  OwnerCategoryDetailPage,
  OwnerCategoryListPage,
  OwnerProductFormPage,
  OwnerProductListPage,
} from './OwnerCatalogPages';
import { OwnerInvoicesPage } from './OwnerInvoicesPage';
import { OwnerDashboardPage } from './OwnerDashboardPage';
import {
  OwnerCustomerDetailPage,
  OwnerCustomerFormPage,
  OwnerCustomerGroupFormPage,
  OwnerCustomerGroupListPage,
  OwnerCustomerListPage,
} from './OwnerCustomerPages';
import { OwnerPromotionFormPage, OwnerPromotionListPage } from './OwnerPromotionPages';

const OwnerPrintSettingsPage = lazy(async () => {
  const module = await import('./OwnerPrintSettingsPage');
  return { default: module.OwnerPrintSettingsPage };
});

const OwnerPrintTemplateEditPage = lazy(async () => {
  const module = await import('./OwnerPrintTemplateEditPage');
  return { default: module.OwnerPrintTemplateEditPage };
});

const BRAND = '#0975F7';

interface StoreSettings {
  id: string;
  name: string;
  status: 'ACTIVE' | 'LOCKED';
  timezone: string;
  phone: string | null;
  address: string | null;
  currency: string;
  businessDayCutoffMinutes: number;
}

type OwnerSection = 'reports' | 'catalog' | 'invoices' | 'staff' | 'customers';

interface OwnerMenuItem {
  key: string;
  label: string;
  icon: ReactNode;
  children?: OwnerMenuItem[];
  section?: OwnerSection;
}

const menuItems: OwnerMenuItem[] = [
  { key: '/owner', label: 'Tổng quan', icon: <DashboardOutlined /> },
  {
    key: 'reports',
    label: 'Báo cáo',
    icon: <BarChartOutlined />,
    section: 'reports',
    children: [
      { key: '/owner/reports/revenue', label: 'Báo cáo doanh thu', icon: <BarChartOutlined /> },
      { key: '/owner/reports/products', label: 'Báo cáo mặt hàng', icon: <ShoppingOutlined /> },
      { key: '/owner/reports/staff', label: 'Báo cáo nhân viên', icon: <TeamOutlined /> },
    ],
  },
  {
    key: 'catalog',
    label: 'Mặt hàng',
    icon: <AppstoreOutlined />,
    section: 'catalog',
    children: [
      { key: '/owner/catalog/products', label: 'Danh sách mặt hàng', icon: <ShoppingOutlined /> },
      { key: '/owner/catalog/categories', label: 'Danh mục', icon: <TagsOutlined /> },
    ],
  },
  {
    key: 'invoices',
    label: 'Hóa đơn',
    icon: <FileTextOutlined />,
    section: 'invoices',
    children: [{ key: '/owner/invoices', label: 'Hóa đơn bán hàng', icon: <FileTextOutlined /> }],
  },
  {
    key: 'staff',
    label: 'Nhân viên',
    icon: <TeamOutlined />,
    section: 'staff',
    children: [
      { key: '/owner/staff', label: 'Danh sách nhân viên', icon: <TeamOutlined /> },
      { key: '/owner/staff/roles', label: 'Vai trò & quyền', icon: <UserOutlined /> },
    ],
  },
  {
    key: 'customers',
    label: 'Khách hàng',
    icon: <TeamOutlined />,
    section: 'customers',
    children: [
      { key: '/owner/customers', label: 'Danh sách khách hàng', icon: <UserOutlined /> },
      { key: '/owner/customer-groups', label: 'Nhóm khách hàng', icon: <TeamOutlined /> },
    ],
  },
  { key: '/owner/promotions', label: 'Khuyến mại', icon: <GiftOutlined /> },
];

const settingsItems: OwnerMenuItem[] = [
  {
    key: '/owner/settings',
    label: 'Thiết lập',
    icon: <SettingOutlined />,
  },
];

const allMenuItems = [...menuItems, ...settingsItems];

function findSection(pathname: string): string | undefined {
  for (const item of allMenuItems) {
    if (
      item.children?.some((child) => pathname === child.key || pathname.startsWith(`${child.key}/`))
    ) {
      return item.key;
    }
  }
  return undefined;
}

function toAntMenuItems(items: OwnerMenuItem[]): NonNullable<MenuProps['items']> {
  return items.map((item) => ({
    key: item.key,
    icon: item.icon,
    label: item.label,
    children: item.children ? toAntMenuItems(item.children) : undefined,
  }));
}

function OwnerSidebar({
  collapsed,
  selectedKey,
  openKeys,
  onOpenChange,
  onNavigate,
  onCollapse,
}: {
  collapsed: boolean;
  selectedKey: string;
  openKeys: string[];
  onOpenChange: (keys: string[]) => void;
  onNavigate: (key: string) => void;
  onCollapse: (() => void) | undefined;
}) {
  const handleMainMenuOpenChange = (keys: string[]) => {
    const latestKey = keys.find((key) => !openKeys.includes(key));
    onOpenChange(latestKey ? [latestKey] : []);
  };

  const handleClick: MenuProps['onClick'] = ({ key }) => {
    if (key.startsWith('/')) {
      onNavigate(key);
    }
  };

  return (
    <aside className={`owner-sidebar${collapsed ? ' owner-sidebar--collapsed' : ''}`}>
      <div className="owner-sidebar__brand">
        <div className="owner-sidebar__logo-wrap">
          <img src={logo} alt="Pro POS" className="owner-sidebar__logo" />
        </div>
        {onCollapse ? (
          <Button
            type="text"
            className="owner-sidebar__collapse-btn"
            aria-label={collapsed ? 'Mở rộng thanh điều hướng' : 'Thu gọn thanh điều hướng'}
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={onCollapse}
          />
        ) : null}
      </div>
      <div className="owner-sidebar__nav-body">
        <Menu
          className="owner-sidebar__menu"
          mode="inline"
          theme="dark"
          inlineCollapsed={collapsed}
          items={toAntMenuItems(menuItems)}
          selectedKeys={[selectedKey]}
          openKeys={openKeys}
          onOpenChange={handleMainMenuOpenChange}
          onClick={handleClick}
        />
      </div>
      <div className="owner-sidebar__pinned-bottom">
        <Menu
          className="owner-sidebar__menu owner-sidebar__menu--settings"
          mode="inline"
          theme="dark"
          inlineCollapsed={collapsed}
          items={toAntMenuItems(settingsItems)}
          selectedKeys={[selectedKey]}
          onClick={handleClick}
        />
      </div>
    </aside>
  );
}

const settingsGroups = [
  {
    title: 'Thiết lập thông tin',
    items: [
      {
        key: '/owner/settings/store',
        title: 'Thông tin cửa hàng',
        description: 'Tên, điện thoại, địa chỉ, tiền tệ và thông tin ngân hàng.',
        icon: <ShopOutlined />,
      },
      {
        key: '/owner/settings/account',
        title: 'Thiết lập tài khoản',
        description: 'Thông tin chủ cửa hàng, email và bảo mật tài khoản.',
        icon: <UserOutlined />,
      },
    ],
  },
  {
    title: 'Thiết lập chức năng',
    items: [
      {
        key: '/owner/settings/units',
        title: 'Thiết lập đơn vị tính',
        description: 'Danh sách đơn vị, mặt hàng đang sử dụng và thao tác quản lý.',
        icon: <TagsOutlined />,
      },
      {
        key: '/owner/settings/devices',
        title: 'Thiết lập thiết bị',
        description: 'Danh sách thiết bị POS và thiết bị nhân viên trong cửa hàng.',
        icon: <CreditCardOutlined />,
      },
      {
        key: '/owner/settings/areas',
        title: 'Thiết lập khu vực',
        description: 'Quản lý khu vực, bàn hoặc phòng và sản phẩm tính giờ.',
        icon: <AppstoreOutlined />,
      },
      {
        key: '/owner/settings/reporting',
        title: 'Thiết lập báo cáo',
        description: 'Đặt giờ chốt ngày kinh doanh và phạm vi tổng hợp báo cáo.',
        icon: <BarChartOutlined />,
      },
      {
        key: '/owner/settings/printing',
        title: 'Thiết lập in',
        description: 'Mẫu hóa đơn, khổ giấy, logo, QR ngân hàng và nội dung chân trang.',
        icon: <PrinterOutlined />,
      },
    ],
  },
  {
    title: 'Khác',
    items: [
      {
        key: '/owner/settings/audit',
        title: 'Nhật ký hoạt động',
        description: 'Theo dõi thời gian, nhân viên, chức năng, thao tác và nội dung thay đổi.',
        icon: <ClockCircleOutlined />,
      },
    ],
  },
] satisfies Array<{
  title: string;
  items: Array<{ key: string; title: string; description: string; icon: ReactNode }>;
}>;

function SettingsHub({ onNavigate }: { onNavigate: (path: string) => void }) {
  return (
    <div className="owner-settings-page">
      <div className="owner-page-heading">
        <div>
          <Typography.Title level={2}>Thiết lập cửa hàng</Typography.Title>
          <Typography.Text type="secondary">
            Quản lý thông tin, cấu hình vận hành và các thiết lập dùng chung của cửa hàng.
          </Typography.Text>
        </div>
      </div>
      <div className="owner-settings-page__groups">
        {settingsGroups.map((group) => (
          <section className="owner-settings-group" key={group.title}>
            <Typography.Title level={4}>{group.title}</Typography.Title>
            <div className="owner-settings-grid">
              {group.items.map((item) => (
                <button
                  className="owner-settings-tile"
                  type="button"
                  key={item.key}
                  onClick={() => onNavigate(item.key)}
                >
                  <span className="owner-settings-tile__icon">{item.icon}</span>
                  <span className="owner-settings-tile__copy">
                    <strong>{item.title}</strong>
                    <small>{item.description}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

const moduleContent: Record<
  string,
  { title: string; eyebrow: string; description: string; bullets: string[] }
> = {
  '/owner/reports/revenue': {
    title: 'Báo cáo doanh thu',
    eyebrow: 'BÁO CÁO',
    description:
      'Chọn loại báo cáo, khoảng thời gian và chuẩn bị xuất Excel khi dữ liệu thật được nối vào.',
    bullets: [
      'Bộ lọc loại báo cáo & thời gian',
      'Biểu đồ doanh thu tổng hợp',
      'Danh sách chi tiết theo ngày',
    ],
  },
  '/owner/reports/products': {
    title: 'Báo cáo mặt hàng',
    eyebrow: 'BÁO CÁO',
    description: 'Theo dõi danh mục và mặt hàng bán chạy theo số lượng hoặc doanh thu.',
    bullets: ['Danh mục mặt hàng', 'Mặt hàng bán chạy', 'Bộ lọc giờ tùy chọn'],
  },
  '/owner/reports/staff': {
    title: 'Báo cáo nhân viên',
    eyebrow: 'BÁO CÁO',
    description: 'Khung báo cáo hiệu suất nhân viên theo doanh thu và số hóa đơn.',
    bullets: ['Doanh thu theo nhân viên', 'Số hóa đơn hoàn tất', 'Khoảng thời gian báo cáo'],
  },
  '/owner/catalog/products': {
    title: 'Danh sách mặt hàng',
    eyebrow: 'MẶT HÀNG',
    description: 'Quản lý mặt hàng số lượng, trọng lượng và thời gian trong cùng một không gian.',
    bullets: [
      'Danh sách & tìm kiếm',
      'Tạo mặt hàng theo loại',
      'Phiên bản giá và nhập giá khi bán',
    ],
  },
  '/owner/catalog/categories': {
    title: 'Danh mục',
    eyebrow: 'MẶT HÀNG',
    description: 'Tạo và sắp xếp danh mục để nhóm mặt hàng dễ tìm trên POS.',
    bullets: ['Danh sách danh mục', 'Tạo danh mục nhanh', 'Xem mặt hàng trong danh mục'],
  },
  '/owner/invoices': {
    title: 'Hóa đơn bán hàng',
    eyebrow: 'HÓA ĐƠN',
    description: 'Tìm kiếm, lọc trạng thái và chuẩn bị xem chi tiết hóa đơn.',
    bullets: ['Tất cả / đã thanh toán / đã hủy', 'Tìm kiếm hóa đơn', 'Xuất Excel'],
  },
  '/owner/staff': {
    title: 'Danh sách nhân viên',
    eyebrow: 'NHÂN VIÊN',
    description: 'Quản lý tài khoản nhân viên được cấp quyền vận hành cửa hàng.',
    bullets: ['Thêm nhân viên', 'Kích hoạt / ngừng kích hoạt', 'Đổi PIN và quyền'],
  },
  '/owner/staff/roles': {
    title: 'Vai trò & quyền',
    eyebrow: 'NHÂN VIÊN',
    description: 'Khung chọn quyền theo nhóm đơn hàng, thanh toán và vận hành.',
    bullets: ['Quyền đơn hàng', 'Quyền thanh toán', 'Quyền áp dụng giảm giá'],
  },
  '/owner/settings/store': {
    title: 'Thông tin cửa hàng',
    eyebrow: 'THIẾT LẬP',
    description: 'Cấu hình thông tin hiển thị và ngày kinh doanh của cửa hàng.',
    bullets: ['Tên, số điện thoại, địa chỉ', 'Tài khoản ngân hàng', 'Thời gian chốt báo cáo'],
  },
  '/owner/settings/account': {
    title: 'Thiết lập tài khoản',
    eyebrow: 'THIẾT LẬP THÔNG TIN',
    description: 'Xem thông tin chủ cửa hàng, email và các tùy chọn bảo mật tài khoản.',
    bullets: ['Họ tên chủ cửa hàng', 'Email và số điện thoại', 'Đăng xuất và bảo mật phiên'],
  },
  '/owner/settings/units': {
    title: 'Đơn vị tính',
    eyebrow: 'THIẾT LẬP',
    description: 'Quản lý đơn vị dùng cho mặt hàng số lượng và trọng lượng.',
    bullets: ['Danh sách đơn vị', 'Thêm / sửa đơn vị', 'Kiểm tra mặt hàng đang sử dụng'],
  },
  '/owner/settings/devices': {
    title: 'Thiết bị',
    eyebrow: 'THIẾT LẬP',
    description: 'Theo dõi các thiết bị POS và trạng thái phiên hoạt động.',
    bullets: ['Thiết bị đang hoạt động', 'Thu hồi thiết bị', 'Cấp lại thông tin thiết bị'],
  },
  '/owner/settings/areas': {
    title: 'Khu vực & bàn',
    eyebrow: 'THIẾT LẬP',
    description: 'Tạo khu vực, bàn và gán mặt hàng tính giờ cho hoạt động POS.',
    bullets: ['Danh sách khu vực', 'Thêm bàn / phòng', 'Gán sản phẩm tính giờ'],
  },
  '/owner/settings/reporting': {
    title: 'Thiết lập báo cáo',
    eyebrow: 'THIẾT LẬP CHỨC NĂNG',
    description: 'Đặt thời gian chốt ngày bán hàng dùng khi tổng hợp báo cáo.',
    bullets: ['Giờ và phút chốt ngày', 'Khoảng dữ liệu ngày kinh doanh', 'Múi giờ cửa hàng'],
  },
  '/owner/settings/printing': {
    title: 'Thiết lập in',
    eyebrow: 'THIẾT LẬP CHỨC NĂNG',
    description: 'Khung cấu hình mẫu in hóa đơn thanh toán và hóa đơn tạm tính.',
    bullets: ['Khổ giấy 58 / 80 mm', 'Logo, QR và chân trang', 'Tùy chọn nội dung & preview in'],
  },
  '/owner/settings/audit': {
    title: 'Nhật ký hoạt động',
    eyebrow: 'THIẾT LẬP',
    description: 'Theo dõi các thao tác quan trọng theo thời gian, người dùng và thiết bị.',
    bullets: ['Thời gian & người thực hiện', 'Chức năng và thao tác', 'Request ID để tra soát'],
  },
};

function ModulePlaceholder({ path }: { path: string }) {
  const content = moduleContent[path] ?? moduleContent['/owner/settings/store']!;
  return (
    <div className="owner-module-placeholder">
      <span className="owner-eyebrow">{content.eyebrow}</span>
      <Typography.Title level={2}>{content.title}</Typography.Title>
      <Typography.Paragraph type="secondary">{content.description}</Typography.Paragraph>
      <div className="owner-module-placeholder__grid">
        {content.bullets.map((bullet, index) => (
          <Card key={bullet} className={`owner-module-card owner-module-card--${index + 1}`}>
            <span>{String(index + 1).padStart(2, '0')}</span>
            <Typography.Text strong>{bullet}</Typography.Text>
          </Card>
        ))}
      </div>
      <Alert
        showIcon
        type="info"
        title="Màn hình đang ở trạng thái khung"
        description="Các form và dữ liệu nghiệp vụ sẽ được nối theo từng ticket tiếp theo, sau khi shell và route guard được duyệt."
      />
    </div>
  );
}

export function OwnerPortalPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const screens = Grid.useBreakpoint();
  const isDesktop = Boolean(screens.xl);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openKeys, setOpenKeys] = useState<string[]>(() => {
    const section = findSection(location.pathname);
    return section ? [section] : [];
  });
  const [, contextHolder] = message.useMessage();

  const context = useQuery({
    queryKey: ['auth-context'],
    queryFn: () => apiRequest<AuthContextResponse>('/api/v1/auth/context'),
  });
  const settings = useQuery({
    queryKey: ['owner-settings'],
    queryFn: () => apiRequest<StoreSettings>('/api/v1/owner/store/settings'),
    enabled: context.data?.actor?.kind === 'OWNER',
  });

  useEffect(() => {
    const currentSection = findSection(location.pathname);
    setOpenKeys(currentSection ? [currentSection] : []);
    setMobileOpen(false);
  }, [location.pathname]);

  const selectedKey = useMemo(() => {
    if (location.pathname === '/owner' || location.pathname === '/owner/') return '/owner';
    if (
      location.pathname === '/owner/settings' ||
      location.pathname.startsWith('/owner/settings/')
    ) {
      return '/owner/settings';
    }
    const direct = allMenuItems
      .filter(
        (item) =>
          item.key !== '/owner' &&
          item.key.startsWith('/') &&
          (location.pathname === item.key || location.pathname.startsWith(`${item.key}/`)),
      )
      .toSorted((left, right) => right.key.length - left.key.length)[0];
    if (direct) return direct.key;
    const match = allMenuItems
      .flatMap((item) => item.children ?? [])
      .filter(
        (item) => location.pathname === item.key || location.pathname.startsWith(`${item.key}/`),
      )
      .toSorted((left, right) => right.key.length - left.key.length)[0];
    return match?.key ?? '/owner';
  }, [location.pathname]);

  const logout = async () => {
    const csrfToken = context.data?.csrfToken;
    try {
      if (csrfToken) {
        await apiRequest<{ loggedOut: boolean; accessLogoutUrl: string | null }>(
          '/api/v1/auth/logout',
          {
            method: 'POST',
            headers: { 'X-CSRF-Token': csrfToken },
          },
        );
      }
    } catch {
      // ignore
    } finally {
      await queryClient.invalidateQueries({ queryKey: ['auth-context'] });
      queryClient.clear();
      window.location.assign('/?tab=owner&loggedOut=1');
    }
  };

  if (context.isLoading) return <Spin fullscreen description="Đang kiểm tra phiên Owner" />;
  if (context.isError || !context.data) {
    return <Navigate to="/?tab=owner&authError=CONNECTION_ERROR" replace />;
  }
  if (context.data.actor?.kind !== 'OWNER') {
    return <Navigate to="/?tab=owner&authError=SESSION_EXPIRED" replace />;
  }

  const sidebar = (
    <OwnerSidebar
      collapsed={collapsed}
      selectedKey={selectedKey}
      openKeys={openKeys}
      onOpenChange={setOpenKeys}
      onNavigate={(key) => navigate(key)}
      onCollapse={isDesktop ? () => setCollapsed((value) => !value) : undefined}
    />
  );

  return (
    <ConfigProvider theme={{ token: { colorPrimary: BRAND } }}>
      {contextHolder}
      <Layout className="owner-shell">
        {isDesktop ? (
          sidebar
        ) : (
          <Drawer
            className="owner-mobile-drawer"
            placement="left"
            closable={false}
            onClose={() => setMobileOpen(false)}
            open={mobileOpen}
            size={280}
            styles={{ body: { padding: 0 } }}
          >
            {sidebar}
          </Drawer>
        )}
        <Layout>
          <header className="owner-header">
            <div className="owner-header__left">
              {!isDesktop ? (
                <Button
                  type="text"
                  aria-label="Mở menu"
                  icon={<MenuUnfoldOutlined />}
                  onClick={() => setMobileOpen(true)}
                />
              ) : null}
              <Typography.Text className="owner-header__store">
                {settings.data?.name ?? 'Cửa hàng của bạn'}
              </Typography.Text>
            </div>
            <div className="owner-header__actions">
              <Dropdown
                trigger={['click']}
                placement="bottomRight"
                menu={{
                  items: [
                    {
                      key: 'help-title',
                      label: (
                        <div
                          style={{
                            padding: '2px 4px',
                            fontSize: 11.5,
                            fontWeight: 700,
                            color: '#64748b',
                          }}
                        >
                          LIÊN HỆ HỖ TRỢ KỸ THUẬT
                        </div>
                      ),
                      disabled: true,
                    },
                    {
                      type: 'divider',
                    },
                    {
                      key: 'call',
                      icon: <PhoneOutlined style={{ color: '#10b981', fontSize: 16 }} />,
                      label: (
                        <a
                          href="tel:0777464347"
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 2,
                            padding: '4px 0',
                          }}
                        >
                          <span style={{ fontSize: 12, color: '#64748b', fontWeight: 500 }}>
                            Gọi điện thoại trực tiếp:
                          </span>
                          <strong style={{ color: '#10b981', fontSize: 14 }}>0777 464 347</strong>
                        </a>
                      ),
                    },
                    {
                      key: 'zalo',
                      icon: <MessageOutlined style={{ color: '#0975F7', fontSize: 16 }} />,
                      label: (
                        <a
                          href="https://zalo.me/0816548150"
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 2,
                            padding: '4px 0',
                          }}
                        >
                          <span style={{ fontSize: 12, color: '#64748b', fontWeight: 500 }}>
                            Nhắn tin tư vấn Zalo:
                          </span>
                          <strong style={{ color: '#0975F7', fontSize: 14 }}>0816 548 150</strong>
                        </a>
                      ),
                    },
                  ],
                }}
              >
                <Button
                  type="text"
                  icon={<QuestionCircleOutlined />}
                  className="owner-header__utility"
                >
                  Trợ giúp
                </Button>
              </Dropdown>
              <Button type="text" icon={<BellOutlined />} aria-label="Thông báo" />
              <Dropdown
                trigger={['click']}
                menu={{
                  items: [
                    {
                      key: 'account-settings',
                      icon: <UserOutlined />,
                      label: 'Thiết lập tài khoản',
                      onClick: () => navigate('/owner/settings/account'),
                    },
                    {
                      type: 'divider',
                    },
                    {
                      key: 'logout',
                      icon: <LogoutOutlined />,
                      label: 'Đăng xuất',
                      onClick: logout,
                    },
                  ],
                }}
              >
                <Button type="text" className="owner-account-button">
                  <Avatar size={34} style={{ background: '#ff5b61' }}>
                    {context.data.actor.displayName.slice(0, 1).toUpperCase()}
                  </Avatar>
                  <span className="owner-account-button__copy">
                    <strong>{context.data.actor.displayName}</strong>
                    <small>Chủ cửa hàng</small>
                  </span>
                </Button>
              </Dropdown>
            </div>
          </header>
          <main className="owner-content">
            {settings.isError && !settings.isLoading ? (
              <Alert
                className="owner-content__alert"
                type="warning"
                showIcon
                title="Chưa tải được thông tin cửa hàng"
                description="Shell vẫn hoạt động; hãy thử tải lại sau."
              />
            ) : null}
            {selectedKey === '/owner' ? (
              <OwnerDashboardPage settings={settings.data} />
            ) : location.pathname === '/owner/settings/store' ? (
              <OwnerStoreSettingsPage />
            ) : location.pathname === '/owner/settings/account' ? (
              <OwnerAccountSettingsPage />
            ) : location.pathname === '/owner/settings/areas' ? (
              <OwnerAreaSettingsPage />
            ) : location.pathname === '/owner/settings/areas/new' ? (
              <OwnerAreaCreatePage />
            ) : location.pathname === '/owner/settings/printing' ? (
              <OwnerPrintSettingsPage />
            ) : location.pathname === '/owner/settings/printing/template' ? (
              <OwnerPrintTemplateEditPage />
            ) : location.pathname === '/owner/settings/units' ? (
              <OwnerUnitSettingsPage />
            ) : location.pathname.startsWith('/owner/settings/units/') ? (
              <OwnerUnitDetailPage unitId={location.pathname.split('/').at(-1)!} />
            ) : location.pathname === '/owner/catalog/products' ? (
              <OwnerProductListPage />
            ) : location.pathname === '/owner/catalog/products/new' ? (
              <OwnerProductFormPage />
            ) : location.pathname.startsWith('/owner/catalog/products/') ? (
              <OwnerProductFormPage productId={location.pathname.split('/').at(-1)!} />
            ) : location.pathname === '/owner/catalog/categories' ? (
              <OwnerCategoryListPage />
            ) : location.pathname.startsWith('/owner/catalog/categories/') ? (
              <OwnerCategoryDetailPage categoryId={location.pathname.split('/').at(-1)!} />
            ) : location.pathname === '/owner/invoices' ? (
              <OwnerInvoicesPage />
            ) : location.pathname === '/owner/promotions' ? (
              <OwnerPromotionListPage />
            ) : location.pathname === '/owner/promotions/new' ? (
              <OwnerPromotionFormPage />
            ) : location.pathname.startsWith('/owner/promotions/') ? (
              <OwnerPromotionFormPage promotionId={location.pathname.split('/')[3]!} />
            ) : location.pathname === '/owner/customers' ? (
              <OwnerCustomerListPage />
            ) : location.pathname === '/owner/customers/new' ? (
              <OwnerCustomerFormPage />
            ) : location.pathname.endsWith('/edit') &&
              location.pathname.startsWith('/owner/customers/') ? (
              <OwnerCustomerFormPage customerId={location.pathname.split('/')[3]!} />
            ) : location.pathname.startsWith('/owner/customers/') ? (
              <OwnerCustomerDetailPage customerId={location.pathname.split('/')[3]!} />
            ) : location.pathname === '/owner/customer-groups' ? (
              <OwnerCustomerGroupListPage />
            ) : location.pathname === '/owner/customer-groups/new' ? (
              <OwnerCustomerGroupFormPage />
            ) : location.pathname.startsWith('/owner/customer-groups/') ? (
              <OwnerCustomerGroupFormPage groupId={location.pathname.split('/')[3]!} />
            ) : location.pathname === '/owner/staff' ? (
              <OwnerStaffListPage />
            ) : location.pathname === '/owner/staff/new' ? (
              <OwnerEmployeeFormPage />
            ) : location.pathname === '/owner/staff/roles' ? (
              <OwnerRolesPage />
            ) : location.pathname === '/owner/staff/roles/new' ? (
              <OwnerRoleFormPage />
            ) : location.pathname.startsWith('/owner/staff/roles/') ? (
              <OwnerRoleFormPage />
            ) : location.pathname.startsWith('/owner/staff/') ? (
              <OwnerEmployeeFormPage />
            ) : selectedKey === '/owner/settings' && location.pathname === '/owner/settings' ? (
              <SettingsHub onNavigate={(path) => navigate(path)} />
            ) : (
              <ModulePlaceholder path={location.pathname} />
            )}
          </main>
        </Layout>
      </Layout>
    </ConfigProvider>
  );
}
