import type { PropsWithChildren } from 'react';

import logoBlack from '@client/assets/logo-black.svg?url';
import logoWhite from '@client/assets/logo-white.svg?url';

export function AuthLayout({ children }: PropsWithChildren) {
  return (
    <div className="auth-page">
      <div className="auth-grid">
        <section className="brand-panel" aria-label="Giới thiệu Pro POS">
          <img className="brand-panel__logo" src={logoWhite} alt="Pro POS" />
          <div className="billiards-visual" aria-hidden="true">
            <span className="cue cue--one" />
            <span className="cue cue--two" />
            <div className="billiards-table">
              <span className="ball ball--one">1</span>
              <span className="ball ball--two">8</span>
              <span className="ball ball--three">3</span>
              <span className="ball ball--four">9</span>
            </div>
          </div>
          <div className="brand-panel__copy">
            <h1>Vận hành cửa hàng billiards dễ dàng hơn</h1>
            <p>Quản lý bàn, tính giờ, gọi món và thanh toán trên cùng một hệ thống Web/PWA.</p>
          </div>
        </section>

        <main className="auth-card">
          <img className="auth-card__logo" src={logoBlack} alt="Pro POS" />
          {children}
          <footer className="auth-card__footer">
            <strong>Pro POS</strong>
            <span>Hệ thống quản lý cửa hàng billiards</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
