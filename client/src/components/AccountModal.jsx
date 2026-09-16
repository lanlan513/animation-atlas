import React, { useState } from 'react';
import { CircleAlert, LoaderCircle, UserRound, X } from 'lucide-react';
import { api, setStoredUser } from '../api.js';

export default function AccountModal({ user, onClose, onError }) {
  const [mode, setMode] = useState('card');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setFormError('');
    setBusy(true);
    try {
      const path = mode === 'register' ? '/auth/register' : '/auth/login';
      const payload = mode === 'register' ? { email, password, displayName } : { email, password };
      const result = await api(path, { method: 'POST', body: payload });
      setStoredUser(result.user);
      location.reload();
    } catch (error) {
      setFormError(error.message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal account-modal">
        <div className="modal-head">
          <div>
            <p className="eyebrow">IDENTITY / LOCAL</p>
            <h2>你的 FrameMold 身份</h2>
          </div>
          <button className="icon-button" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="identity-card">
          <div className="big-avatar"><UserRound size={24} /></div>
          <div>
            <strong>{user.displayName}</strong>
            <p>{user.isGuest ? '匿名访客 · 素材保存在这台服务器上' : user.email}</p>
          </div>
          <span className="identity-badge">{user.isGuest ? 'GUEST' : 'MEMBER'}</span>
        </div>
        {mode === 'card' ? (
          <>
            <p className="modal-note">访客即可直接拍摄，项目与素材都归属于当前身份。注册账号后可在不同浏览器之间继续工作。</p>
            <div className="modal-actions" style={{ justifyContent: 'stretch' }}>
              <button className="button secondary" onClick={() => setMode('login')}>登录</button>
              <button className="button primary" onClick={() => setMode('register')}>注册账号</button>
            </div>
          </>
        ) : (
          <form onSubmit={submit}>
            {mode === 'register' && (
              <label className="field">显示名称<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={40} /></label>
            )}
            <label className="field">邮箱<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
            <label className="field">密码（至少 8 位）<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} /></label>
            {formError && <p className="form-error"><CircleAlert size={14} />{formError}</p>}
            <div className="modal-actions">
              <button type="button" className="button ghost" onClick={() => setMode('card')}>返回</button>
              <button className="button primary" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : null}{mode === 'register' ? '注册并进入' : '登录'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
