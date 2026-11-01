// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { GeneralDesignHub } from '../src/components/org/GeneralDesignHub';
import { OrgHub } from '../src/components/org/OrgHub';
import { queueOrganizationWorkspaceRoute } from '../src/lib/orgWorkspaceNavigation';
import { normalizeOrganizationWorkspaceView, listOrganizationWorkspaceViewsForRole } from '../shared/org_workspace';
import { getPersonalClientSurfaceByAction } from '../shared/client_surfaces';
vi.mock('../src/contexts/AppContext', () => ({ useApp: () => ({ workDomain: 'work', orgConnection: { orgId: 'fixture-org', orgRole: 'viewer' }, switchDomain: vi.fn() }) }));
vi.mock('../src/lib/useT', () => ({ useT: () => ({ langCode: 'en' }) }));
vi.mock('../src/i18n/uiMessages', () => ({ uiMessage: (key: string) => key }));
afterEach(() => { cleanup(); sessionStorage.clear(); vi.unstubAllGlobals(); });
it.each(['project','cad','visualization','presentation','handoff'])('keeps designer %s action registered alongside main business entries', id => {
  expect(getPersonalClientSurfaceByAction(`open_design_${id}`)?.target).toBe(`design-${id}`);
  expect(getPersonalClientSurfaceByAction('open_finance_workspace')?.target).toBe('business-finance');
  expect(getPersonalClientSurfaceByAction('open_ecommerce_workspace')?.target).toBe('business-ecommerce');
});
it('retains main brand and designer interior aliases without expanding administrative rights', () => {
  expect(normalizeOrganizationWorkspaceView('brand')).toBe('brand-design'); expect(normalizeOrganizationWorkspaceView('creative')).toBe('brand-design');
  expect(normalizeOrganizationWorkspaceView('interior')).toBe('spatial-design'); expect(normalizeOrganizationWorkspaceView('interior-design')).toBe('spatial-design');
  const viewer = listOrganizationWorkspaceViewsForRole('viewer'); expect(viewer).toContain('brand-design'); expect(viewer).toContain('spatial-design'); expect(viewer).not.toContain('members'); expect(viewer).not.toContain('audit');
});
it.each(['spatial','brand'] as const)('mounts every main %s navigation tool without model or provider calls', async workspace => {
  const transport = vi.fn(() => { throw new Error('Unexpected transport'); }); vi.stubGlobal('fetch', transport);
  const view = render(<GeneralDesignHub workspace={workspace} />);
  const buttons = Array.from(view.container.querySelectorAll<HTMLButtonElement>('nav button'));
  expect(buttons.length).toBe(workspace === 'spatial' ? 3 : 6);
  for (const button of buttons) { fireEvent.click(button); expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(button.title); }
  expect(transport).not.toHaveBeenCalled();
});
it.each(['spatial-design','brand-design'] as const)('resolves the queued %s organization route to the main design component', async destination => {
  queueOrganizationWorkspaceRoute(destination); const transport = vi.fn(() => { throw new Error('Unexpected transport'); }); vi.stubGlobal('fetch', transport);
  const view = render(<OrgHub />); await act(async () => {});
  expect(await screen.findByRole('heading', { level: 2, name: destination === 'spatial-design' ? 'design-hub.space-planning.45b68a19b1' : 'design-hub.brand-design.4883ca5345' })).toBeTruthy();
  expect(view.container.querySelector('[data-organization-wallpaper-module="design"]')).toBeTruthy(); expect(transport).not.toHaveBeenCalled();
});
