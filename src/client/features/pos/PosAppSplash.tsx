import React from 'react';

export function PosAppSplash({ message = 'Đang khởi động Pro POS...' }: { message?: string }) {
  return (
    <div className="pos-app-splash" role="status" aria-live="polite">
      <div className="pos-app-splash__content">
        <div className="pos-app-splash__logo-wrap">
          <div className="pos-app-splash__pulse-ring" />
          <div className="pos-app-splash__pulse-ring pos-app-splash__pulse-ring--outer" />
          <div className="pos-app-splash__icon">
            <svg
              width="44"
              height="44"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <rect x="2" y="3" width="20" height="14" rx="3" fill="#0975f7" />
              <path d="M7 8H17M7 11H13" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />
              <path d="M6 17L4 21H20L18 17H6Z" fill="#0056b3" />
              <circle cx="12" cy="19" r="1" fill="#ffffff" />
            </svg>
          </div>
        </div>
        <div className="pos-app-splash__brand">PRO POS</div>
        <div className="pos-app-splash__progress">
          <div className="pos-app-splash__progress-bar" />
        </div>
        <div className="pos-app-splash__message">{message}</div>
      </div>
    </div>
  );
}
