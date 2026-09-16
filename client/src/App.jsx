import React, { useCallback, useEffect, useState } from 'react';
import { CircleAlert, LoaderCircle, RefreshCw } from 'lucide-react';
import { api, getStoredUser, setStoredUser, clearStoredUser } from './api.js';
import Home from './components/Home.jsx';
import Studio from './components/Studio.jsx';
import Toast, { useToast } from './components/Toast.jsx';

export default function App() {
  const [user, setUser] = useState(() => getStoredUser());
  const [state, setState] = useState('loading');
  const [bootError, setBootError] = useState('');
  const { toast, showToast, dismissToast } = useToast();

  const bootstrap = useCallback(async () => {
    setState('loading');
    setBootError('');
    try {
      let current = getStoredUser();
      if (current) {
        try {
          const result = await api('/auth/me');
          current = result.user;
        } catch (error) {
          if (error.status !== 401) throw error;
          current = null;
        }
      }
      if (!current) {
        clearStoredUser();
        const result = await api('/auth/guest', { method: 'POST' });
        current = result.user;
      }
      setStoredUser(current);
      setUser(current);
      setState('ready');
    } catch (error) {
      setBootError(error.message);
      setState('error');
    }
  }, []);

  useEffect(() => { bootstrap(); }, [bootstrap]);

  if (state === 'loading') {
    return <div className="screen-state"><LoaderCircle className="spin" size={26} /><span>正在点亮拍摄台…</span></div>;
  }
  if (state === 'error') {
    return <div className="screen-state">
      <CircleAlert size={26} />
      <span>连接失败：{bootError}</span>
      <button className="button ghost" onClick={bootstrap}><RefreshCw size={15} />重试</button>
    </div>;
  }

  return (
    <>
      <StudioRouter user={user} onError={showToast} />
      {toast && <Toast toast={toast} onClose={dismissToast} />}
    </>
  );
}

function StudioRouter({ user, onError }) {
  const initialId = location.hash.startsWith('#/studio/') ? location.hash.slice(9) : null;
  const [openProjectId, setOpenProjectId] = useState(initialId);

  useEffect(() => {
    const onHash = () => {
      const match = location.hash.match(/^#\/studio\/(.+)$/);
      setOpenProjectId(match ? match[1] : null);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const openProject = (id) => { location.hash = `#/studio/${id}`; setOpenProjectId(id); };
  const closeProject = () => { location.hash = ''; setOpenProjectId(null); };

  if (openProjectId) {
    return <Studio key={openProjectId} user={user} projectId={openProjectId} onClose={closeProject} onError={onError} />;
  }
  return <Home user={user} onOpen={openProject} onError={onError} />;
}
