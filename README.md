# 浙江省博物馆 AR 导览游客满意度问卷系统

一个简洁的问卷收集与统计系统，用于收集浙江省博物馆 AR 导览体验的游客反馈数据。

## 功能特性

- **问卷收集**：包含基本资料、AR 体验评分（李克特量表）、开放建议三部分
- **实时统计**：提交后即时更新统计数据，无需刷新
- **统计面板**：可视化展示人口学分布、各题均值、最新建议
- **双端口架构**：问卷端与统计端分离，便于权限管理

## 快速开始

### 安装依赖

```bash
npm install
```

### 启动服务

```bash
node server.js
```

### 访问地址

| 服务 | 端口 | 地址 |
|------|------|------|
| 问卷填写 | 1144 | http://localhost:1144/ |
| 统计面板 | 1145 | http://localhost:1145/ |

## 项目结构

```
├── index.html          # 问卷前端页面
├── stats.html          # 统计面板页面
├── server.js           # Express 后端服务
├── package.json        # 项目配置
└── data/
    └── responses.json  # 问卷数据存储
```

## API 接口

### 提交问卷

```
POST /api/surveys
Content-Type: application/json
```

### 获取统计

```
GET /api/stats
```

返回示例：
```json
{
  "count": 10,
  "demographics": {
    "gender": { "男": 6, "女": 4 },
    "age": { "18-25岁": 3, "26-40岁": 5, "41-60岁": 2 },
    "edu": { "本科": 7, "硕士及以上": 3 },
    "tech": { "偶尔尝试": 5, "经常使用": 3, "几乎从不": 2 }
  },
  "likertStats": {
    "A1": { "average": 3.8, "answered": 10 },
    ...
  },
  "suggestions": {
    "count": 5,
    "latest": ["建议1", "建议2", ...]
  },
  "lastUpdated": "2025-12-10T08:00:00.000Z"
}
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `SURVEY_PORT` | 1144 | 问卷服务端口 |
| `STATS_PORT` | 1145 | 统计服务端口 |

## 技术栈

- **后端**：Node.js + Express
- **前端**：原生 HTML/CSS/JavaScript
- **存储**：JSON 文件

## 许可证

MIT
