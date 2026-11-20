window.__ModuleLoader__.load({
  id: '@local/dsh-acp-bridge',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React
    const NS = 'acpBridge'
    const PANEL_ID = 'acp'

    const en = {
      panel: 'ACP',
      title: 'ACP',
      subtitle: 'Enable ACP providers and manage their CLI versions. Models appear in the chat model selector only while their provider is enabled.',
      updatePolicy: 'Updates are checked automatically on the first DSH start of each day.',
      checking: 'Checking for updates…',
      checkedToday: 'Checked today',
      checkIncomplete: 'Today’s check did not complete for every CLI',
      noManaged: 'No managed CLIs to check',
      notChecked: 'No update check yet',
      enabled: 'Enabled',
      disabled: 'Disabled',
      toggle: 'Enable {name}',
      version: 'CLI {version}',
      codexVersion: 'Codex CLI {version}',
      adapterVersion: 'ACP adapter {packageName} {version}',
      unavailableVersion: 'CLI version unavailable',
      newVersion: 'New version {version}',
      newAdapterVersion: 'New ACP adapter version {version}',
      upgrade: 'Upgrade',
      upgradeAdapter: 'Upgrade adapter',
      upgradeFor: 'Upgrade {name} to {version}',
      upgradeAdapterFor: 'Upgrade the {name} ACP adapter to {version}',
      upgrading: 'Upgrading…',
      saving: 'Saving…',
      savedRefreshFailed: 'Saved, but the page could not refresh. The switch shows the saved state.',
      restartRequired: 'Version {version} is installed. Restart DSH to use it.',
      adapterRestartRequired: 'ACP adapter {version} is installed. Restart DSH to use it and its compatible Codex CLI dependency.',
      external: 'External CLI · managed upgrades unavailable',
      cursorExternal: 'Updated by Cursor CLI · run agent update manually if needed',
      codexDescription: 'Use Codex models through the official codex-acp adapter.',
      cursorDescription: 'Use Cursor models through the official agent acp command. Install the CLI and run agent login before enabling.',
      genericDescription: 'ACP model provider.',
      loading: 'Loading ACP providers…',
      loadFailed: 'Could not read ACP state',
      retry: 'Retry',
      operationFailed: 'ACP operation failed',
      upgradeFailed: 'Upgrade failed',
      checkFailed: 'Update check failed',
      upgradeSuccess: 'The new CLI is installed. Restart DSH to use it.',
      adapterUpgradeSuccess: 'The ACP adapter and its Codex CLI dependency are installed. Restart DSH to use them.',
      empty: 'No ACP providers are configured.',
      closeNotice: 'Dismiss notification',
    }
    const zh = {
      panel: 'ACP',
      title: 'ACP',
      subtitle: '启用 ACP 并管理对应 CLI 的版本。只有启用后，其模型才会出现在聊天模型选择器中。',
      updatePolicy: '每天首次启动 DSH 时自动检查更新。',
      checking: '正在检查更新…',
      checkedToday: '今天已检查更新',
      checkIncomplete: '今天的部分 CLI 未能完成检查',
      noManaged: '没有可自动检查的 CLI',
      notChecked: '尚未检查更新',
      enabled: '已启用',
      disabled: '已禁用',
      toggle: '启用 {name}',
      version: 'CLI {version}',
      codexVersion: 'Codex CLI {version}',
      adapterVersion: 'ACP 适配器 {packageName} {version}',
      unavailableVersion: '无法获取 CLI 版本',
      newVersion: '新版本 {version}',
      newAdapterVersion: 'ACP 适配器新版本 {version}',
      upgrade: '升级',
      upgradeAdapter: '升级适配器',
      upgradeFor: '将 {name} 升级到 {version}',
      upgradeAdapterFor: '将 {name} 的 ACP 适配器升级到 {version}',
      upgrading: '升级中…',
      saving: '正在保存…',
      savedRefreshFailed: '设置已保存，但页面刷新失败；开关已显示保存后的状态。',
      restartRequired: '已安装 {version}，重启 DSH 后生效。',
      adapterRestartRequired: 'ACP 适配器 {version} 已安装，重启 DSH 后使用该适配器及其兼容的 Codex CLI 依赖。',
      external: '外部 CLI · 不支持自动升级',
      cursorExternal: '由 Cursor CLI 自动更新 · 需要时可运行 agent update',
      codexDescription: '通过官方 codex-acp 适配器使用 Codex 模型。',
      cursorDescription: '通过官方 agent acp 命令使用 Cursor 模型。启用前请安装 CLI 并运行 agent login 登录。',
      genericDescription: 'ACP 模型提供程序。',
      loading: '正在加载 ACP…',
      loadFailed: '无法读取 ACP 状态',
      retry: '重试',
      operationFailed: 'ACP 操作失败',
      upgradeFailed: '升级失败',
      checkFailed: '更新检查失败',
      upgradeSuccess: '新 CLI 已安装，重启 DSH 后使用新版本。',
      adapterUpgradeSuccess: 'ACP 适配器及其 Codex CLI 依赖已安装，重启 DSH 后使用。',
      empty: '尚未配置 ACP。',
      closeNotice: '关闭通知',
    }

    const css = `
      .dsh-acp-page { box-sizing: border-box; width: 100%; height: 100%; overflow: auto;
        color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base);
        font-size: 14px; line-height: 1.6; scrollbar-gutter: stable; }
      .dsh-acp-content { max-width: 960px; margin: 0 auto; padding: 0 clamp(24px, 4vw, 48px) 48px; }
      .dsh-acp-heading { padding-top: 28px; margin-bottom: 24px; }
      html[data-platform='darwin'] .dsh-acp-heading { padding-top: calc(28px + var(--dsh-frame-top-clearance, 0px)); }
      .dsh-acp-heading h1 { margin: 0; font-size: 20px; line-height: 28px; font-weight: 500; }
      .dsh-acp-subtitle { max-width: 720px; margin: 6px 0 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }
      .dsh-acp-update-line { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; margin-bottom: 16px;
        color: var(--dsw-alias-label-secondary); font-size: 12px; }
      .dsh-acp-checking { display: inline-flex; align-items: center; gap: 6px; color: var(--dsw-alias-label-primary); }
      .dsh-acp-list { display: grid; gap: 12px; margin: 0; padding: 0; list-style: none; }
      .dsh-acp-card { display: flex; align-items: flex-start; gap: 14px; min-width: 0; padding: 18px;
        border: 0.5px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-lg, 12px);
        background: var(--dsw-alias-bg-base); }
      .dsh-acp-card[data-disabled='true'] { background: color-mix(in srgb, var(--dsw-alias-label-primary) 2%, transparent); }
      .dsh-acp-avatar { display: grid; place-items: center; flex: none; width: 42px; height: 42px;
        border: 0.5px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-md, 9px);
        color: var(--dsw-alias-label-secondary); background: color-mix(in srgb, var(--dsw-alias-label-primary) 4%, transparent); }
      .dsh-acp-main { flex: 1; min-width: 0; }
      .dsh-acp-name-line { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; }
      .dsh-acp-name { margin: 0; font-size: 15px; line-height: 22px; font-weight: 500; overflow-wrap: anywhere; }
      .dsh-acp-status, .dsh-acp-update-badge { display: inline-flex; align-items: center; min-height: 20px;
        padding: 0 7px; border-radius: 10px; font-size: 11px; line-height: 18px; }
      .dsh-acp-status { color: var(--dsw-alias-label-secondary); background: color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent); }
      .dsh-acp-status[data-on='true'] { color: var(--dsw-alias-label-primary); background: color-mix(in srgb, var(--dsw-alias-label-primary) 10%, transparent); }
      .dsh-acp-update-badge { color: var(--dsw-alias-label-primary); border: 0.5px solid var(--dsw-alias-border-l2); }
      .dsh-acp-description { margin: 3px 0 0; color: var(--dsw-alias-label-secondary); font-size: 13px; }
      .dsh-acp-meta { display: flex; flex-wrap: wrap; gap: 3px 12px; margin: 8px 0 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
      .dsh-acp-package { overflow-wrap: anywhere; font-family: var(--dsh-font-family-code, monospace); font-size: 11px; }
      .dsh-acp-actions { display: flex; flex: none; align-items: center; gap: 12px; min-height: 42px; }
      .dsh-acp-saving { display: inline-flex; align-items: center; gap: 6px; color: var(--dsw-alias-label-secondary); font-size: 12px; white-space: nowrap; }
      .dsh-acp-switch { position: relative; box-sizing: border-box; flex: none; width: 36px; height: 20px; padding: 0;
        border: 0; border-radius: 10px; cursor: pointer; background: color-mix(in srgb, var(--dsw-alias-label-primary) 18%, transparent);
        transition: background 120ms ease; }
      .dsh-acp-switch::after { content: ''; position: absolute; top: 3px; left: 3px; width: 14px; height: 14px;
        border-radius: 50%; background: var(--dsw-alias-bg-base); box-shadow: 0 0 0 0.5px var(--dsw-alias-border-l3);
        transition: transform 120ms ease; }
      .dsh-acp-switch[aria-checked='true'] { background: var(--dsw-alias-label-primary); }
      .dsh-acp-switch[aria-checked='true']::after { transform: translateX(16px); }
      .dsh-acp-switch:focus-visible, .dsh-acp-button:focus-visible, .dsh-acp-notice button:focus-visible {
        outline: 2px solid var(--dsw-alias-label-caption); outline-offset: 2px; }
      .dsh-acp-switch:disabled, .dsh-acp-button:disabled { cursor: default; opacity: .5; }
      .dsh-acp-button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; box-sizing: border-box;
        min-height: 30px; padding: 0 12px; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 15px;
        color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); font: inherit; font-size: 12px; cursor: pointer; }
      .dsh-acp-button[data-primary='true'] { color: var(--dsw-alias-bg-base); background: var(--dsw-alias-label-primary);
        border-color: var(--dsw-alias-label-primary); }
      @media (hover: hover) { .dsh-acp-button:not(:disabled):hover { background: color-mix(in srgb, var(--dsw-alias-label-primary) 7%, var(--dsw-alias-bg-base)); }
        .dsh-acp-button[data-primary='true']:not(:disabled):hover { color: var(--dsw-alias-label-primary); } }
      .dsh-acp-spinner { display: inline-block; width: 12px; height: 12px; border: 1.5px solid currentColor;
        border-right-color: transparent; border-radius: 50%; animation: dsh-acp-spin .7s linear infinite; }
      @keyframes dsh-acp-spin { to { transform: rotate(360deg); } }
      .dsh-acp-error, .dsh-acp-restart { margin: 8px 0 0; font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
      .dsh-acp-error { color: var(--dsw-alias-label-error, var(--dsw-alias-label-primary)); }
      .dsh-acp-restart { color: var(--dsw-alias-label-secondary); }
      .dsh-acp-notice { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin: 0 0 16px;
        padding: 10px 12px; border: 0.5px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-md, 9px);
        color: var(--dsw-alias-label-secondary); font-size: 13px; }
      .dsh-acp-notice[data-error='true'] { color: var(--dsw-alias-label-error, var(--dsw-alias-label-primary)); }
      .dsh-acp-notice > span { min-width: 0; overflow-wrap: anywhere; }
      .dsh-acp-notice button { flex: none; padding: 0; border: 0; color: inherit; background: transparent; cursor: pointer; font-size: 16px; }
      .dsh-acp-loading, .dsh-acp-empty, .dsh-acp-failure { padding: 40px 0; text-align: center; color: var(--dsw-alias-label-secondary); }
      .dsh-acp-skeleton { display: grid; gap: 12px; }
      .dsh-acp-skeleton > div { height: 112px; border-radius: var(--dsw-radius-lg, 12px);
        background: color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent); animation: dsh-acp-pulse 1.2s ease-in-out infinite alternate; }
      @keyframes dsh-acp-pulse { to { opacity: .45; } }
      @media (max-width: 767px) { .dsh-acp-content { padding-inline: 20px; } }
      @media (max-width: 560px) { .dsh-acp-card { flex-wrap: wrap; padding: 14px; }
        .dsh-acp-main { min-width: calc(100% - 56px); }
        .dsh-acp-actions { width: 100%; justify-content: flex-end; min-height: 30px; } }
      @media (prefers-reduced-motion: reduce) { .dsh-acp-spinner, .dsh-acp-skeleton > div { animation: none; }
        .dsh-acp-switch, .dsh-acp-switch::after { transition: none; } }
    `

    function AcpIcon({ size = 20 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
        h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 4, stroke: 'currentColor', strokeWidth: 1.5 }),
        h('path', { d: 'M8 9h8M8 13h5M8 17h3', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }))
    }

    function Spinner() {
      return h('span', { className: 'dsh-acp-spinner', 'aria-hidden': true })
    }

    function Switch({ checked, disabled, label, onChange, buttonRef }) {
      return h('button', {
        ref: buttonRef, type: 'button', className: 'dsh-acp-switch', role: 'switch', 'aria-checked': checked,
        'aria-label': label, disabled, onClick: () => onChange(!checked),
      })
    }

    function ProviderRow({ provider, busy, switchDisabled, upgradeDisabled, t, onToggle, onUpgrade, switchRef }) {
      const pendingVersion = provider.installedVersion || provider.latestVersion
      const saving = busy && !provider.upgrading
      const adapterUpdate = provider.updateKind === 'adapter'
      return h('li', { className: 'dsh-acp-card', 'data-disabled': !provider.enabled },
        h('div', { className: 'dsh-acp-avatar' }, h(AcpIcon, { size: 23 })),
        h('div', { className: 'dsh-acp-main' },
          h('div', { className: 'dsh-acp-name-line' },
            h('h2', { className: 'dsh-acp-name' }, provider.name),
            h('span', { className: 'dsh-acp-status', 'data-on': provider.enabled }, t(provider.enabled ? 'enabled' : 'disabled')),
            provider.updateAvailable && h('span', { className: 'dsh-acp-update-badge' }, t(adapterUpdate ? 'newAdapterVersion' : 'newVersion', { version: provider.latestVersion }))),
          h('p', { className: 'dsh-acp-description' }, t(provider.id === 'codex' ? 'codexDescription' : provider.id === 'cursor' ? 'cursorDescription' : 'genericDescription')),
          h('div', { className: 'dsh-acp-meta' },
            provider.managed && h('span', null, provider.version ? t(provider.id === 'codex' ? 'codexVersion' : 'version', { version: provider.version }) : t('unavailableVersion')),
            h('span', { className: 'dsh-acp-package' }, provider.managed ? provider.packageName : t(provider.id === 'cursor' ? 'cursorExternal' : 'external'))),
          provider.adapterVersion && h('div', { className: 'dsh-acp-meta' },
            h('span', { className: 'dsh-acp-package' }, t('adapterVersion', { packageName: provider.adapterPackageName, version: provider.adapterVersion }))),
          provider.checkError && h('p', { className: 'dsh-acp-error', role: 'status' }, `${t('checkFailed')}: ${provider.checkError}`),
          provider.upgradeError && h('p', { className: 'dsh-acp-error', role: 'alert' }, `${t('upgradeFailed')}: ${provider.upgradeError}`),
          provider.restartRequired && h('p', { className: 'dsh-acp-restart', role: 'status', tabIndex: -1 }, t(adapterUpdate ? 'adapterRestartRequired' : 'restartRequired', { version: adapterUpdate ? (provider.adapterInstalledVersion || provider.latestVersion) : pendingVersion }))),
        h('div', { className: 'dsh-acp-actions' },
          saving && h('span', { className: 'dsh-acp-saving', role: 'status' }, h(Spinner), t('saving')),
          provider.updateAvailable && h('button', {
            type: 'button', className: 'dsh-acp-button', 'data-primary': true,
            'aria-label': t(adapterUpdate ? 'upgradeAdapterFor' : 'upgradeFor', { name: provider.name, version: provider.latestVersion }),
            disabled: busy || upgradeDisabled, onClick: () => onUpgrade(provider),
          }, provider.upgrading ? h(Spinner) : null, provider.upgrading ? t('upgrading') : t(adapterUpdate ? 'upgradeAdapter' : 'upgrade')),
          h(Switch, {
            checked: provider.enabled, disabled: busy || switchDisabled, buttonRef: switchRef,
            label: t('toggle', { name: provider.name }),
            onChange: enabled => onToggle(provider, enabled),
          })))
    }

    function errorMessage(value, fallback) {
      if (value?.error?.message) return value.error.message
      if (value instanceof Error) return value.message
      if (typeof value === 'string') return value
      return fallback
    }

    function AcpPage({ t, request }) {
      const [snapshot, setSnapshot] = useState(undefined)
      const [loadError, setLoadError] = useState(undefined)
      const [notice, setNotice] = useState(undefined)
      const [busy, setBusy] = useState({})
      const mounted = useRef(false)
      const sequence = useRef(0)
      const switchRefs = useRef(new Map())

      const load = useCallback(async (showError = true) => {
        const own = ++sequence.current
        try {
          const result = await request('state', {})
          if (!mounted.current || own !== sequence.current) return false
          if (!result?.ok || !Array.isArray(result.value?.providers)) throw result
          setSnapshot(result.value)
          setLoadError(undefined)
          return true
        } catch (error) {
          if (showError && mounted.current && own === sequence.current) setLoadError(errorMessage(error, 'Unavailable'))
          return false
        }
      }, [request])

      useEffect(() => {
        mounted.current = true
        void load()
        return () => { mounted.current = false; sequence.current++ }
      }, [load])

      useEffect(() => {
        if (!snapshot?.checking && !snapshot?.providers.some(provider => provider.upgrading)) return undefined
        const timer = setTimeout(() => { void load(false) }, 1000)
        return () => clearTimeout(timer)
      }, [snapshot, load])

      const toggle = async (provider, enabled) => {
        setBusy(value => ({ ...value, [provider.id]: true }))
        setNotice(undefined)
        try {
          const result = await request('set-enabled', { id: provider.id, enabled })
          if (!result?.ok) throw result
          // The Host confirmed the save. Keep that authoritative state visible
          // even if a separate status refresh loses the connection.
          if (mounted.current) setSnapshot(value => value ? {
            ...value,
            providers: value.providers.map(item => item.id === provider.id ? { ...item, enabled: result.value.enabled } : item),
          } : value)
          const refreshed = await load()
          if (!refreshed && mounted.current) setNotice({ error: true, text: t('savedRefreshFailed') })
        } catch (error) {
          if (mounted.current) setNotice({ error: true, text: `${t('operationFailed')}: ${errorMessage(error, '')}` })
        } finally {
          if (mounted.current) setBusy(value => ({ ...value, [provider.id]: false }))
        }
      }

      const upgrade = async provider => {
        let completed = false
        setBusy(value => ({ ...value, [provider.id]: true }))
        setSnapshot(value => ({ ...value, providers: value.providers.map(item => item.id === provider.id ? { ...item, upgrading: true } : item) }))
        setNotice(undefined)
        try {
          const result = await request('upgrade', { id: provider.id })
          if (!result?.ok) throw result
          completed = true
          if (mounted.current) {
            setSnapshot(result.value)
            setNotice({ error: false, text: t(provider.updateKind === 'adapter' ? 'adapterUpgradeSuccess' : 'upgradeSuccess') })
          }
        } catch (error) {
          if (mounted.current) setNotice({ error: true, text: `${t('upgradeFailed')}: ${errorMessage(error, '')}` })
          await load(false)
        } finally {
          if (mounted.current) {
            setBusy(value => ({ ...value, [provider.id]: false }))
            if (completed) requestAnimationFrame(() => switchRefs.current.get(provider.id)?.focus())
          }
        }
      }

      const checking = snapshot?.checking === true
      const hasManaged = snapshot?.providers.some(provider => provider.managed) === true
      const checkIncomplete = snapshot?.providers.some(provider => Boolean(provider.checkError)) === true
      const operationBusy = Object.values(busy).some(Boolean)
        || snapshot?.providers.some(provider => provider.upgrading) === true
      const summaryKey = !hasManaged ? 'noManaged' : checkIncomplete ? 'checkIncomplete' : snapshot?.lastCheckDate ? 'checkedToday' : 'notChecked'
      return h('section', { className: 'dsh-acp-page', 'aria-label': t('title') },
        h('style', null, css),
        h('div', { className: 'dsh-acp-content' },
          h('header', { className: 'dsh-acp-heading' },
            h('h1', null, t('title')),
            h('p', { className: 'dsh-acp-subtitle' }, t('subtitle'))),
          notice && h('div', { className: 'dsh-acp-notice', 'data-error': notice.error, role: notice.error ? 'alert' : 'status' },
            h('span', null, notice.text),
            h('button', { type: 'button', 'aria-label': t('closeNotice'), onClick: () => setNotice(undefined) }, '×')),
          snapshot && h('div', { className: 'dsh-acp-update-line', role: 'status' },
            checking ? h('span', { className: 'dsh-acp-checking' }, h(Spinner), t('checking'))
              : h('span', null, t(summaryKey)),
            hasManaged && h('span', null, t('updatePolicy'))),
          !snapshot && !loadError && h('div', { className: 'dsh-acp-skeleton', 'aria-label': t('loading'), role: 'status' },
            h('div'), h('div'), h('div')),
          loadError && !snapshot && h('div', { className: 'dsh-acp-failure', role: 'alert' },
            h('p', null, `${t('loadFailed')}: ${loadError}`),
            h('button', { type: 'button', className: 'dsh-acp-button', onClick: () => { setLoadError(undefined); void load() } }, t('retry'))),
          snapshot && snapshot.providers.length === 0 && h('p', { className: 'dsh-acp-empty' }, t('empty')),
          snapshot && h('ul', { className: 'dsh-acp-list' }, snapshot.providers.map(provider => h(ProviderRow, {
            key: provider.id, provider, t, busy: busy[provider.id] === true,
            switchDisabled: checking || operationBusy, upgradeDisabled: checking || operationBusy,
            switchRef: node => { if (node) switchRefs.current.set(provider.id, node); else switchRefs.current.delete(provider.id) },
            onToggle: toggle, onUpgrade: upgrade,
          })))))
    }

    return {
      inject: ['slots', 'locale', 'layout', 'connection'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'acp-bridge: dictionaries')
        const t = ctx.locale.bind(NS)
        const transportFetch = globalThis.__DSH_TRANSPORT__?.fetch ?? globalThis.fetch.bind(globalThis)
        const request = async (endpoint, payload) => {
          const response = await transportFetch('api/acp-bridge', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ endpoint, payload }),
          })
          if (!response.ok) throw new Error(`transport failure for /api/acp-bridge: HTTP ${response.status}`)
          return await response.json()
        }
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: PANEL_ID, locale: NS,
          inject: () => ({ request }),
        }, AcpPage))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: PANEL_ID, order: 5, locale: NS,
          label: () => t('panel'),
        }, AcpIcon))
      },
    }
  },
})
