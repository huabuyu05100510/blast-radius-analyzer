# Blast Radius Analyzer

**改动影响范围分析器** - 追踪代码改动的下游影响范围

## 特性

- 🔍 **符号级追踪** - 精确定位符号的所有引用
- 📊 **调用栈视图** - 完整展示调用链路
- 🔗 **传播路径追踪** - 追踪常量、类型、嵌套属性的传播
- 🔬 **数据流分析** - 商业级数据流追踪 (DataFlow Pro)
- 📈 **类型流分析** - TypeFlow Pro 类型兼容性检查
- ⚡ **CI/CD 集成** - 支持阈值告警和退出码
- 💾 **智能缓存** - 增量分析，秒级响应

## 安装

```bash
# npm
npm install -g blast-radius-analyzer

# 或者直接运行
npx blast-radius-analyzer
```

## 使用

### 基本用法

```bash
# 分析改动影响
blast-radius -p ./src -c ./src/api/user.ts

# 指定符号
blast-radius -p ./src -c ./src/api/task.ts --symbol getTaskStats

# CI/CD 模式 - 阈值告警
blast-radius -p ./src -c ./src/api/task.ts --threshold files:5,score:100

# JSON 输出
blast-radius -p ./src -c ./src/api/task.ts -o result.json

# 轻量模式 (不加载完整项目)
blast-radius -p ./src -c ./src/api/task.ts -t
```

### 参数说明

| 参数 | 说明 |
|------|------|
| `-p, --project` | 项目根目录 |
| `-c, --change` | 改动的文件路径 |
| `--symbol` | 改动的符号名 (函数/变量/类型等) |
| `-t, --symbol-only` | 轻量模式，不加载完整项目 |
| `--threshold` | CI/CD 阈值 (files:N,score:N) |
| `-o, --output` | JSON 输出文件 |
| `--clear-cache` | 清除缓存后重新分析 |

## 示例输出

```
┌─────────────────────────────────────────────────────────────────┐
│                    📊 改动影响范围分析报告                         │
└─────────────────────────────────────────────────────────────────┘

📝 改动内容
   文件: task.ts
   符号: getTaskStats
   类型: 修改

🚨 风险等级: 🟢 低风险

📈 影响范围
   ├─ 受影响文件: 2 个
   ├─ 直接引用: 3 处
   └─ 调用点: 1 处

📞 调用栈视图

📍 getTaskStats (改动点) [function] → task.ts:7
   └─ fetchStats [function] → index.tsx:130
      ├─ handleRegenerate [arrow] → index.tsx:178
      └─ handleStop [arrow] → index.tsx:187

📊 数据流分析 (DataFlow Pro)
   基本块: 5 | 条件分支: 1 | 类型收窄: 1 | 置信度: medium
```

## 工作原理

1. **符号分析** - 使用 TypeScript Language Service 查找符号的所有引用
2. **调用链追踪** - 递归追踪函数的调用者，构建完整调用栈
3. **传播追踪** - 追踪常量、类型、嵌套对象的传播路径
4. **数据流分析** - 基于 CFG 和格论抽象解释的数据流追踪
5. **风险评估** - 基于影响范围和调用深度计算风险等级

## 支持的场景

| 改动类型 | 追踪能力 |
|----------|----------|
| 导出函数 | ✅ 完整调用链 |
| 导出常量 | ✅ 传播路径 |
| 导出类型/接口 | ✅ 引用追踪 |
| 嵌套对象属性 | ✅ 传播路径 |
| 类/模块导出 | ✅ 实例化追踪 |

## License

MIT
