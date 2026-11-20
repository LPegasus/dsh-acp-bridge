# ACP bridge for DeepSeek Harness

把支持 [Agent Client Protocol (ACP)](https://agentclientprotocol.com/) 的外部 Agent 注册为 DeepSeek Harness 的模型 Provider。内置 **Codex (ACP)** 和 **Cursor Agent (ACP)**。默认启用 Codex，通过官方 [`@agentclientprotocol/codex-acp`](https://github.com/agentclientprotocol/codex-acp) 适配器复用本机 Codex 的登录状态和模型能力；Cursor Agent 默认列出但关闭，安装并登录 Cursor CLI 后可启用。

## 使用

1. 确认 Codex 已安装并已登录：`codex login status`。
2. 安装并启用本插件。
3. 打开左侧导航中的 **ACP** 管理页，确认 **Codex (ACP)** 的开关已启用（默认启用）。
4. 新建聊天，在模型选择器中选择 **Codex (ACP)** 下的模型。
5. 外部 Agent 的文本和思考会流式显示在 DSH 聊天中。

插件依赖中已包含 `codex-acp` 及其兼容的 Codex 包，不需要再次全局安装。它默认使用本机 `~/.codex` 中的登录信息。若需指定另一个 Codex 可执行文件，可在 Provider 的 `env` 中设置 `CODEX_PATH`。

### Cursor Agent

1. 按 [Cursor CLI 官方安装文档](https://cursor.com/docs/cli/installation) 安装独立 CLI。Windows PowerShell 安装命令为 `irm 'https://cursor.com/install?win32=true' | iex`。
2. 运行 `agent --version` 验证安装，再运行 `agent login` 登录；也可通过 DSH 进程环境提供 `CURSOR_API_KEY` 或 `CURSOR_AUTH_TOKEN`。
3. 在左侧 **ACP** 页面启用 **Cursor Agent (ACP)**。插件使用官方 [`agent acp`](https://cursor.com/docs/cli/acp) 命令启动服务。
4. 在聊天模型选择器中选择 Cursor Agent 提供的模型。

Cursor CLI 默认自动更新，需要手动更新时运行 `agent update`，因此管理页不使用 Codex 的 npm 托管升级方式。Cursor 的权限选项使用 `allow-once` / `reject-once` 等连字符形式，插件已与标准下划线形式一并兼容。

> 模型请求会交给本机 ACP 进程，再由外部 Agent 发往其模型服务商。网络、账号额度和服务商限制仍由该 Agent 及其账号决定。

## 首版边界

ACP 暴露的是完整 Agent 会话，而不是原始 LLM 补全接口。桥接采用以下语义：

- 每次 DSH 模型请求创建独立 ACP 会话，以 DSH 日志中的系统提示和消息历史为准；重试、压缩和恢复不依赖外部隐藏历史。
- 支持动态模型目录、模型切换、推理级别切换、文本/思考流、取消和进程回收。
- **DSH 工具定义不会成为外部 Agent 的可调用工具。** 历史 DSH 工具调用和结果会以纯文本形式放进对话上下文。外部 Agent 使用自己的工具，其执行过程不会映射为 DSH 工具调用事件。
- 首版为纯文本路由，不转发图片或音频，也不上报 token 用量。
- 内置 Codex 默认 `INITIAL_AGENT_MODE=read-only`；其他 Agent 的初始模式由其自身决定。所有 Provider 默认 `permission: reject`。显式设置 `permission: allow` 后，插件会自动选择 `allow_once` / `allow-once`（若没有则选择 `allow_always` / `allow-always`），请只在理解自动批准的风险后使用。
- 模型目录按 ACP 实际返回值展示，**不做 GPT 名称过滤**。需要固定或筛选目录时，使用 `models` 静态列表。
- 禁用插件会注销模型 Provider 并终止其 ACP 子进程，不会删除 Codex 的账号或会话数据。

## ACP 管理与 CLI 更新

左侧 **ACP** 页面列出所有已配置的 Provider。每行有独立开关；关闭后插件会从 DSH 的 LLM 注册表中移除该 Provider，聊天模型选择器不再列出或解析它的模型，相关 ACP 子进程也会随配置重载而回收。重新启用后即可再次选择模型。

内置 Codex 面板将 **OpenAI Codex CLI** 与 **ACP 适配器**分开显示：主版本号来自适配器实际解析到的 `@openai/codex` 依赖（当前为 `0.170.0`），另一行显示 `@agentclientprotocol/codex-acp` 适配器版本（当前为 `2.8.0`）。每日检查和**升级适配器**按钮针对 `codex-acp`；升级后的适配器会携带其声明的兼容 Codex CLI 依赖，面板再从所选适配器解析新的实际 CLI 版本，而不是把适配器版本冒充 OpenAI Codex 版本。

DSH 在每个本地自然日的**首次启动**检查一次适配器新版本，检查日期和结果保存在 `$DSH_HOME/cache/acp-bridge/state.json`；同一天后续启动、页面刷新和开关重载都不会重复检查，失败当天也不会自动重试。只有远端最新稳定适配器版本高于当前已安装版本时，对应行才显示 **升级适配器** 按钮。

升级通过本机 npm 安装到 `$DSH_HOME/cache/acp-bridge/packages/<provider>/<version>`，不同版本相互隔离，不修改插件包或 Profile 的依赖清单，也不覆盖正在运行的 CLI。安装成功后按钮消失，页面提示**重启 DSH 后生效**。安装失败会继续使用旧版本并显示错误。Windows 上直接解析 `npm-cli.js` 后由 Node 执行，不需要 shell。系统没有 npm、注册表不可达或安装超时时，更新检查/升级会报告失败，但不影响当前 ACP 使用。

自定义 `command` 的外部 CLI 会出现在管理列表并可开关，但插件不会猜测其包来源，因此不自动检查或替换它。若自定义 Provider 的 `command` 为空且设置了 `packageName`，则同样使用上述托管安装和升级机制。

## 配置

Provider 的开关和高级字段可在 Cordis 配置覆盖层中编辑；不要直接修改插件包内的 `cordis.patch.yml`，以免升级时丢失定制。完整字段如下（省略字段使用所示默认值）：

```yaml
- id: acp-bridge
  name: '@local/dsh-acp-bridge'
  config:
    providers:
      codex:
        displayName: Codex (ACP)
        enabled: true
        # command 为空时，packageName 指定可自动检查和升级的 ACP CLI 包。
        packageName: '@agentclientprotocol/codex-acp'
        # 空 command 使用插件内置或已托管升级的官方 codex-acp。
        command: ''
        args: []
        env:
          NO_BROWSER: '1'
          INITIAL_AGENT_MODE: read-only
          MODEL_PROVIDER: dsh_http
          CODEX_CONFIG: '{"model_provider":"dsh_http","model_providers":{"dsh_http":{"name":"OpenAI HTTP","base_url":"https://chatgpt.com/backend-api/codex","wire_api":"responses","requires_openai_auth":true,"supports_websockets":false,"supports_standalone_web_search":true}}}'
        # 空 cwd 使用当前 DSH 会话工作目录。
        cwd: ''
        permission: reject
        allowImplicitModel: false
        startupTimeoutMs: 90000
        # 动态目录缓存毫秒数；0 表示每次访问都重新发现。
        modelCacheMs: 60000
        models: []
      cursor:
        displayName: Cursor Agent (ACP)
        enabled: false
        command: agent
        args: [acp]
        permission: reject
        models: []
```

内置 Codex 默认使用插件专用的 `dsh_http` Provider，将 Responses 固定为 HTTPS（`supports_websockets=false`），避免部分网络中 WebSocket 握手超时导致 `session/prompt` 一直等待。该 JSON 只传给插件启动的 ACP 进程，**不会修改全局 Codex 配置**。若你的环境不需要此回退，可在自定义 `env` 中去掉 `MODEL_PROVIDER` 和 `CODEX_CONFIG`，恢复 Codex 自己的 Provider 与传输选择。

`models` 为空时通过 ACP 动态发现。网络发现不可用或需要固定目录时，可手动声明模型：

```yaml
providers:
  codex:
    displayName: Codex (ACP)
    command: ''
    env:
      NO_BROWSER: '1'
      INITIAL_AGENT_MODE: read-only
      MODEL_PROVIDER: dsh_http
      CODEX_CONFIG: '{"model_provider":"dsh_http","model_providers":{"dsh_http":{"name":"OpenAI HTTP","base_url":"https://chatgpt.com/backend-api/codex","wire_api":"responses","requires_openai_auth":true,"supports_websockets":false,"supports_standalone_web_search":true}}}'
    models:
      - id: gpt-example-id
        name: GPT example
        contextWindow: 258400
        maxTokens: 32768
        reasoningEfforts: [low, medium, high]
```

将 `gpt-example-id` 替换为 Codex 实际支持的模型 ID；`contextWindow`、`maxTokens` 和 `reasoningEfforts` 也应按该模型填写，示例数值不是自动探测结果。**静态列表在保存和展示时不会做在线校验**；发送请求时，如果 Agent 暴露模型选择器，插件会校验并切换模型。设置 `allowImplicitModel: true` 表示 Agent 没有模型选择能力时信任启动命令已经选定模型，此时不会进行这项在线校验，配置错误只能由外部 Agent 自己报告。

### 模型发现失败时

依次检查：启动命令是否正确、外部 Agent 是否已登录、其网络和服务商是否可用。Codex 可运行 `codex login status` 与 `codex doctor --summary`；Cursor Agent 可运行 `agent status`、`agent about` 与 `agent models`。冷启动较慢时增大 `startupTimeoutMs`。如果只是在线目录不可用，可先按上一节配置 `models` 静态列表；这只能跳过**目录发现**，实际请求仍需要外部 Agent 能创建会话并访问其模型服务。插件不会把 ACP 子进程原始 stderr 写入模型错误，避免其中可能存在的账号或配置细节进入聊天。

### 接入其他 ACP Agent

在 `providers` 中增加条目。已有配置若缺少 `cursor`，插件会自动补入默认关闭的 Cursor Agent；自定义 Provider 映射不会自动恢复已被移除的 Codex，仍需 Codex 时请保留 `codex` 条目：

```yaml
providers:
  another-agent:
    displayName: Another agent (ACP)
    enabled: true
    command: /absolute/path/to/acp-agent
    args: []
    env: {}
    permission: reject
    models: []
```

`command` 也可以是 PATH 中的命令名。参数直接传递，不经过 shell。每个 Provider 使用一个长期复用的 ACP 进程，模型请求则使用独立会话。

`CODEX_API_KEY`、`OPENAI_API_KEY`、`CODEX_HOME`、`CODEX_PATH` 和 `MODEL_PROVIDER` 会从 DSH 进程环境显式传给 Codex 适配器；`CURSOR_API_KEY` 和 `CURSOR_AUTH_TOKEN` 会显式传给 Cursor Agent。其他敏感环境变量不会默认继承。可用 Provider 的 `env` 添加其他变量，但配置文件中的明文密钥应尽量避免。

## 开发验证

```sh
pnpm install --ignore-scripts
pnpm run check
pnpm test
pnpm run probe:codex
```

`probe:codex` 会执行一次真实、短文本的 Codex 请求。仅检查模型目录：

```sh
ACP_PROBE_MODELS_ONLY=1 pnpm run probe:codex
```

Windows PowerShell 使用 `$env:ACP_PROBE_MODELS_ONLY='1'`。也可通过 `ACP_PROBE_MODEL` 指定模型，通过 `ACP_PROBE_STARTUP_MS` 调整启动等待时间。
