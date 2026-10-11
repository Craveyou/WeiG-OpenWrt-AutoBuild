# 构建失败归因：安装依赖、容量和执行超时

故障证据集中在 Catalog `compatibility.json`；原生 Kconfig 关系仍是可选性的权威。
网页共用一个“编译警示”，固件 Worker 只重建并执行，不新增软件包审查。

| Run | 已确认阶段和原因 | 处理归属 |
| --- | --- | --- |
| [37603997193](https://github.com/weigefenxiang/WeiG-OpenWrt-AutoBuild/actions/runs/37603997193) | iStoreOS/24.10 前端编译成功，RootFS OPKG 安装缺少 baidupcs-web | Catalog BLD-0015：精确源码、feeds、x86/64/Generic 环境；网页提示风险，不禁止原生 Y |
| [37593841726](https://github.com/weigefenxiang/WeiG-OpenWrt-AutoBuild/actions/runs/37593841726) | Lienol/25.12 提供后端，构建成功 | 不套用 iStoreOS 故障证据 |
| [37906980210](https://github.com/weigefenxiang/WeiG-OpenWrt-AutoBuild/actions/runs/37906980210) | 512 MiB ext4 分区分配失败，报 failed to allocate 613 blocks；压缩 SquashFS 约 186.92 MiB，对应未压缩内容约 651 MiB | 分区容量，不记坏插件规则；增大目标支持的 RootFS 或减少软件 |
| [38038813800](https://github.com/weigefenxiang/WeiG-OpenWrt-AutoBuild/actions/runs/38038813800) | ImmortalWrt/master 在包编译期间触及 350 分钟 Job 上限；单线程诊断未执行 | 执行时间，不是确定的软件包不兼容，也不是 RootFS 安装失败 |

## 共用机制及退休边界

- 编译警示同时展示原生配置一致性和 Catalog 已确认故障；共用既有 N/M/Y、最少合法操作、回滚、变更预览及强制审计。安装故障不再经过第二个“配置预检”弹窗及重复取消路径。
- Target/Subtarget/Profile、BROKEN、NGINX 和 provider 条件仍由原始关系表达；不为 mtwifi、qmodem-hc 等另写包名限制。静态缺后端候选需精确 Run 或现有 L3 证据，不直接扩展成全源禁用规则。
- 推荐不是默默改配置。应用后的最终状态留在弹窗，自动联动默认折叠；显式确认才继续下载。关闭取消后续提交；强制继续保留原选择和既有审计字段。
- 旧 #547 的回归发现：仅修改推荐值会留下导入的显式 Y，使最终重建恢复已取消的软件。确认后的兼容操作现在复用用户意图路径更新对应覆盖值；仍不把自动联动全部标为用户选择。

## 执行时间与日志

原 Run 的普通 build.log/download.log 已保留，不能说所有日志都丢失；不足在于 Job 超时前
没有冻结详细包日志，且最终汇总把未运行的重试误写成失败。

保持现有 350 分钟 Job 上限，初始化 335 分钟执行截止时间，预留 15 分钟收集证据及上传。
并行编译和单线程诊断共用剩余预算；诊断仍最多 180 分钟。超时不再启动重试，汇总分别标记
未启动、未执行、中断、超时、实际失败及单线程恢复。截止保护是执行控制，不是配置门禁。

软件数量只能提示风险，无法证明编译一定超时。未知包大小不能当作零；压缩 SquashFS
体积不能用作 ext4 分区所需容量。提高并发或多给十分钟也不能保证大型组合成功。

## 本地验证边界

共享引擎、推荐意图回写、Worker 结果分类、六源真实 JSON 下载/导入/编辑页及配置重建有回归。
测试不创建 Issue、不触发固件构建。Windows 本地通过不代替 Linux CI、全部历史分支验证
或新的固件成功证据；发布结果以对应提交的 CI 和部署身份核验为准。
