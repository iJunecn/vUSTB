'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Loader2, Plus, Trash2, Shirt } from 'lucide-react';

type Texture = {
  id: number;
  type: 'skin' | 'cape';
  model: string;
  name: string;
  url: string;
};

type Player = {
  id: number;
  uuid: string;
  name: string;
  skin_texture_id: number | null;
  cape_texture_id: number | null;
  skin_url: string | null;
  cape_url: string | null;
};

export default function RolesPage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [wardrobe, setWardrobe] = useState<Texture[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const [p, w] = await Promise.all([
        api.get<Player[]>('/players'),
        api.get<Texture[]>('/textures/wardrobe'),
      ]);
      setPlayers(p.data);
      setWardrobe(w.data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function createPlayer(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      await api.post('/players', { name: newName });
      setNewName('');
      await refresh();
    } catch (err: any) {
      setError(err?.response?.data?.detail || '创建失败');
    } finally {
      setCreating(false);
    }
  }

  async function bind(playerId: number, type: 'skin' | 'cape', textureId: number | null) {
    const body: any = {};
    if (type === 'skin') {
      if (textureId === null) body.clear_skin = true;
      else body.skin_texture_id = textureId;
    } else {
      if (textureId === null) body.clear_cape = true;
      else body.cape_texture_id = textureId;
    }
    await api.post(`/players/${playerId}/bind`, body);
    await refresh();
  }

  async function removePlayer(id: number) {
    if (!confirm('删除该角色？皮肤绑定将被清除。')) return;
    await api.delete(`/players/${id}`);
    await refresh();
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-bold">游戏角色</h1>
        <p className="text-muted-foreground">
          创建你的 Minecraft 角色,绑定皮肤后即可在 MC 客户端通过 authlib-injector 登录。
        </p>
      </header>

      <form onSubmit={createPlayer} className="glass-card p-5 flex items-end gap-3 flex-wrap">
        <label className="flex-1 min-w-[200px] space-y-1">
          <span className="text-sm font-medium block">新角色名（MC 用户名）</span>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="input"
            placeholder="2-24 字符,不含空格"
            required
          />
        </label>
        <button type="submit" disabled={creating} className="btn-primary">
          {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          创建
        </button>
        {error && <p className="text-sm text-destructive w-full">{error}</p>}
      </form>

      {loading ? (
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      ) : (
        <div className="space-y-4">
          {players.map((p) => (
            <div key={p.id} className="glass-card p-5 space-y-3">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <h3 className="text-lg font-semibold">{p.name}</h3>
                  <code className="text-xs text-muted-foreground">{p.uuid}</code>
                </div>
                <button
                  onClick={() => removePlayer(p.id)}
                  className="text-sm text-destructive hover:underline inline-flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" /> 删除角色
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <BindSlot
                  label="皮肤"
                  type="skin"
                  currentId={p.skin_texture_id}
                  currentUrl={p.skin_url}
                  wardrobe={wardrobe}
                  onBind={(id) => bind(p.id, 'skin', id)}
                />
                <BindSlot
                  label="披风"
                  type="cape"
                  currentId={p.cape_texture_id}
                  currentUrl={p.cape_url}
                  wardrobe={wardrobe}
                  onBind={(id) => bind(p.id, 'cape', id)}
                />
              </div>
            </div>
          ))}
          {players.length === 0 && (
            <p className="text-muted-foreground">还没有角色,创建一个开始游戏。</p>
          )}
        </div>
      )}
    </div>
  );
}

function BindSlot({
  label,
  type,
  currentId,
  currentUrl,
  wardrobe,
  onBind,
}: {
  label: string;
  type: 'skin' | 'cape';
  currentId: number | null;
  currentUrl: string | null;
  wardrobe: Texture[];
  onBind: (id: number | null) => void;
}) {
  const options = wardrobe.filter((t) => t.type === type);
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex items-center gap-3">
        <div className="w-16 h-16 rounded-xl bg-muted/40 flex items-center justify-center overflow-hidden">
          {currentUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={currentUrl} alt="" className="w-full h-full object-contain" style={{ imageRendering: 'pixelated' }} />
          ) : (
            <Shirt className="w-6 h-6 text-muted-foreground" />
          )}
        </div>
        <div className="flex-1 space-y-1">
          <select
            value={currentId ?? ''}
            onChange={(e) => onBind(e.target.value ? Number(e.target.value) : null)}
            className="input"
          >
            <option value="">未绑定</option>
            {options.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} {type === 'skin' ? `(${t.model})` : ''}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
