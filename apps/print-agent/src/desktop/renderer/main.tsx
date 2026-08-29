import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AgentRuntimeState } from '../../core/agent-runtime';
import '../shared/desktop-api';

const initialState: AgentRuntimeState = {
  status: 'STOPPED', printer: 'UNKNOWN', pairing: { code: null, expiresAt: null }, lastError: null, updatedAt: 0,
};

function App() {
  const [state, setState] = useState(initialState);
  const [message, setMessage] = useState('');
  useEffect(() => {
    void window.proposPrintAgent.getState().then(setState);
    return window.proposPrintAgent.onStateChanged(setState);
  }, []);
  const testPrinter = async () => {
    const result = await window.proposPrintAgent.testPrinter();
    setMessage(result.ok ? `Đã gửi lệnh in thử tới ${result.host}:${result.port}.` : result.error || 'Không thể kết nối máy in.');
  };
  return <main>
    <h1>PRO POS Print Agent</h1>
    <p className={`status ${state.status.toLowerCase()}`}>● {state.status}</p>
    <section><b>Cloud</b><span>{state.status === 'ONLINE' ? 'Đã kết nối' : 'Đang kết nối hoặc chờ ghép nối'}</span></section>
    <section><b>Máy in</b><span>{state.printer}</span></section>
    {state.pairing.code && <section><b>Mã ghép nối</b><span className="code">{state.pairing.code}</span></section>}
    {state.lastError && <p className="error">{state.lastError}</p>}
    {message && <p className="message">{message}</p>}
    <div className="actions"><button onClick={() => void testPrinter()}>In thử</button><button onClick={() => void window.proposPrintAgent.reconnect()}>Kết nối lại</button></div>
  </main>;
}

createRoot(document.getElementById('root')!).render(<App />);
