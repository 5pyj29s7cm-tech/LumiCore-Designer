import React, { useEffect, useRef, useState } from 'react';
import { designerLifecycleCopy } from '../../i18n/locales/designerLifecycle';
import { apiFetch } from '../../services/apiClient';
import { withRequestDeadline } from '../../lib/requestDeadline';
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileText,
  Files,
  Image as ImageIcon,
  Loader2,
  Package,
  Ruler,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  interiorProjectAssetUrl,
  listInteriorProjectAssets,
  removeInteriorProjectAsset,
  updateInteriorProjectAsset,
  type InteriorAssetCategory,
  type InteriorProject,
  type InteriorProjectDomain,
  type InteriorProjectAsset,
} from '../../lib/interiorProjects';
import {
  interiorDesignMessage,
  type InteriorDesignLocale,
  type InteriorDesignMessageKey,
} from '../../i18n/locales/interiorDesign';

interface InteriorProjectAssetsProps {
  domain: InteriorProjectDomain;
  project: InteriorProject;
  locale: InteriorDesignLocale;
  onAssetsChange: (assets: InteriorProjectAsset[]) => void;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function isImageAsset(asset: InteriorProjectAsset): boolean {
  return asset.mimeType.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|tiff?|heic)$/i.test(asset.displayName);
}

function AssetIcon({ asset }: { asset: InteriorProjectAsset }) {
  if (isImageAsset(asset)) return <ImageIcon size={17} />;
  if (asset.category === 'cad' || /\.(dwg|dxf|ifc|rvt)$/i.test(asset.displayName)) return <Ruler size={17} />;
  if (asset.category === 'material') return <Package size={17} />;
  return <FileText size={17} />;
}

export function InteriorProjectAssets({ domain, project, locale, onAssetsChange }: InteriorProjectAssetsProps) {
  const m = (key: InteriorDesignMessageKey) => interiorDesignMessage(key, locale);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [assets, setAssets] = useState<InteriorProjectAsset[]>([]);
  const [category, setCategory] = useState<InteriorAssetCategory>('floor-plan');
  const [expanded, setExpanded] = useState(true);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [removingId, setRemovingId] = useState('');
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  const categoryLabels: Record<InteriorAssetCategory, string> = {
    'floor-plan': m('floorPlanAsset'),
    cad: m('cadAsset'),
    'site-photo': m('sitePhotoAsset'),
    material: m('materialAsset'),
    reference: m('referenceAsset'),
    other: m('otherAsset'),
  };

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    listInteriorProjectAssets(domain, project.id, controller.signal)
      .then(items => {
        if (cancelled) return;
        setAssets(items);
        onAssetsChange(items);
      })
      .catch(reason => {
        if (!cancelled) setError(`${m('assetLoadFailed')}：${reason?.message || reason}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; controller.abort(); };
  // Project identity is the load boundary; the parent setter is stable.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain, project.id, locale, reload]);

  const publishAssets = (next: InteriorProjectAsset[]) => {
    setAssets(next);
    onAssetsChange(next);
  };

  const uploadFiles = async (files: FileList | null) => {
    const selected = Array.from(files || []);
    if (selected.length === 0 || uploading) return;
    setUploading(true);
    setError('');
    try {
      const formData = new FormData();
      selected.forEach(file => formData.append('files', file));
      formData.append('domain', domain);
      formData.append('interiorProjectId', project.id);
      formData.append('interiorAssetCategory', category);
      const response = await withRequestDeadline(signal => apiFetch(`/api/files/upload?domain=${encodeURIComponent(domain)}`, {
        method: 'POST',
        body: formData,
        signal,
      }), undefined, 60_000);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Upload failed (${response.status})`);
      const next = await listInteriorProjectAssets(domain, project.id);
      publishAssets(next);
      window.dispatchEvent(new CustomEvent('lumi:knowledge-updated', {
        detail: {
          domain,
          files: (data.files || []).map((file: any) => ({ id: file.id, name: file.name, displayName: file.displayName })),
        },
      }));
      window.dispatchEvent(new CustomEvent('lumi:client-state-refresh'));
    } catch (reason: any) {
      setError(`${m('assetUploadFailed')}：${reason?.message || reason}`);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const changeCategory = async (asset: InteriorProjectAsset, nextCategory: InteriorAssetCategory) => {
    setError('');
    try {
      const updated = await updateInteriorProjectAsset(domain, project.id, asset.id, nextCategory);
      publishAssets(assets.map(item => item.id === updated.id ? updated : item));
    } catch (reason: any) {
      setError(`${m('projectSaveFailed')}：${reason?.message || reason}`);
    }
  };

  const removeAsset = async (asset: InteriorProjectAsset) => {
    if (!window.confirm(m('removeAssetConfirm'))) return;
    setRemovingId(asset.id);
    setError('');
    try {
      await removeInteriorProjectAsset(domain, project.id, asset.id);
      publishAssets(assets.filter(item => item.id !== asset.id));
    } catch (reason: any) {
      setError(`${m('assetRemoveFailed')}：${reason?.message || reason}`);
    } finally {
      setRemovingId('');
    }
  };

  const statusLabel = (asset: InteriorProjectAsset): string => {
    if (asset.extractionStatus === 'indexed') return m('sourceIndexed');
    if (asset.extractionStatus === 'partial') return m('sourcePartial');
    return m('sourceStored');
  };

  return (
    <section className="border-b border-white/[0.08] bg-black/10 px-6 py-4">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => setExpanded(value => !value)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-violet-300/15 bg-violet-400/10 text-violet-200">
              <Files size={17} />
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-2 text-sm font-black text-white/80">
                {m('assetLibrary')}
                <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-white/45">{assets.length}</span>
              </span>
              <span className="mt-0.5 line-clamp-1 block text-xs text-white/35">{m('assetLibraryDescription')}</span>
            </span>
            {expanded ? <ChevronUp size={16} className="ml-auto shrink-0 text-white/35" /> : <ChevronDown size={16} className="ml-auto shrink-0 text-white/35" />}
          </button>

          <select value={category} onChange={event => setCategory(event.target.value as InteriorAssetCategory)} aria-label={m('assetCategory')} className="lumi-field py-2 text-xs">
            {(Object.keys(categoryLabels) as InteriorAssetCategory[]).map(value => <option key={value} value={value}>{categoryLabels[value]}</option>)}
          </select>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".pdf,.dwg,.dxf,.ifc,.rvt,.png,.jpg,.jpeg,.webp,.heic,.tif,.tiff,.doc,.docx,.xls,.xlsx,.csv,.txt"
            onChange={event => uploadFiles(event.target.files)}
            className="hidden"
          />
          <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading} className="lumi-button-primary border-violet-400/25 bg-violet-500/15 px-4 py-2.5 text-violet-100 disabled:cursor-not-allowed disabled:opacity-45">
            {uploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
            {uploading ? m('uploadingFiles') : m('uploadFiles')}
          </button>
        </div>

        {error && <div role="alert" className="mt-3 text-xs text-rose-300/90"><p>{error}</p><button type="button" disabled={loading} onClick={() => setReload(value => value + 1)} className="lumi-button mt-2">{designerLifecycleCopy(locale).retry}</button><p>{designerLifecycleCopy(locale).refreshOnly}</p></div>}

        {expanded && (
          <div className="mt-4">
            {loading ? (
              <div className="flex items-center gap-2 py-4 text-xs text-white/40"><Loader2 size={14} className="animate-spin" />{m('loadingProjects')}</div>
            ) : assets.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/[0.08] px-4 py-5 text-center">
                <p className="text-sm text-white/45">{m('noAssets')}</p>
                <p className="mt-1 text-xs text-white/25">{m('fileLimit')}</p>
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {assets.map(asset => {
                  const fileUrl = interiorProjectAssetUrl(domain, asset);
                  return (
                    <article key={asset.id} className="group overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.035]">
                      {isImageAsset(asset) && (
                        <a href={fileUrl} target="_blank" rel="noreferrer" className="block h-24 overflow-hidden border-b border-white/[0.06] bg-black/20">
                          <img src={fileUrl} alt={asset.displayName} loading="lazy" className="h-full w-full object-cover opacity-80 transition-opacity group-hover:opacity-100" />
                        </a>
                      )}
                      <div className="p-3">
                        <div className="flex items-start gap-2">
                          <span className="mt-0.5 shrink-0 text-violet-200/70"><AssetIcon asset={asset} /></span>
                          <div className="min-w-0 flex-1">
                            <a href={fileUrl} target="_blank" rel="noreferrer" title={asset.displayName} className="line-clamp-2 text-sm font-bold leading-snug text-white/75 hover:text-violet-100">
                              {asset.displayName}
                            </a>
                            <div className="mt-1 flex items-center gap-2 text-[11px] text-white/30">
                              <span>{formatBytes(asset.rawSize)}</span>
                              <span>{statusLabel(asset)}</span>
                            </div>
                          </div>
                        </div>
                        <div className="mt-3 flex items-center gap-2">
                          <select value={asset.category} onChange={event => changeCategory(asset, event.target.value as InteriorAssetCategory)} aria-label={m('assetCategory')} className="lumi-field min-w-0 flex-1 py-1.5 text-[11px]">
                            {(Object.keys(categoryLabels) as InteriorAssetCategory[]).map(value => <option key={value} value={value}>{categoryLabels[value]}</option>)}
                          </select>
                          <a href={fileUrl} target="_blank" rel="noreferrer" aria-label={m('openFile')} title={m('openFile')} className="rounded-lg border border-white/[0.07] p-2 text-white/40 hover:border-violet-300/20 hover:text-violet-100">
                            <ExternalLink size={13} />
                          </a>
                          <button type="button" onClick={() => removeAsset(asset)} disabled={removingId === asset.id} aria-label={m('removeAsset')} title={m('removeAsset')} className="rounded-lg border border-white/[0.07] p-2 text-white/35 hover:border-rose-300/20 hover:text-rose-200 disabled:opacity-40">
                            {removingId === asset.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
