// Simple Express backend for survey collection and stats (two ports: 80 and 1145)
const express = require('express');
const fs = require('fs/promises');
const path = require('path');

const surveyApp = express(); // 端口 1144，用于问卷填写与提交
const statsApp = express();  // 端口 1145，用于统计查看
const SURVEY_PORT = process.env.SURVEY_PORT || 1144;
const STATS_PORT = process.env.STATS_PORT || 1145;
const DATA_FILE = path.join(__dirname, 'data', 'responses.json');
const LIKERT_IDS = [
  'A1','A2','A3','A4','A5','A6','A7','A8','A9','A10','A11','A12','A13','A14','A15',
  'B1','B2','B3','B4','B5','B6','B7','B8','B9',
  'C1','C2','C3','C4','C5','C6'
];

surveyApp.use(express.json({ limit: '1mb' }));
surveyApp.use(express.static(__dirname));

// 统计端服务
statsApp.use(express.json({ limit: '1mb' }));

// 默认进入统计面板（必须在 static 之前定义，否则会被 index.html 拦截）
statsApp.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'stats.html'));
});

// 静态资源放在自定义路由后面
statsApp.use(express.static(__dirname));

async function ensureStore() {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch (err) {
    await fs.writeFile(DATA_FILE, '[]', 'utf8');
  }
}

function validatePayload(payload) {
  const requiredFields = ['gender', 'age', 'edu', 'tech'];
  const errors = [];

  requiredFields.forEach((field) => {
    if (!payload[field]) {
      errors.push(`缺少必填字段: ${field}`);
    }
  });

  LIKERT_IDS.forEach((id) => {
    const value = Number(payload[id]);
    if (!Number.isFinite(value) || value < 1 || value > 5) {
      errors.push(`题目 ${id} 的评分无效，需为 1-5 之间的数字`);
    }
  });

  return errors;
}

async function readAll() {
  await ensureStore();
  const raw = await fs.readFile(DATA_FILE, 'utf8');
  return JSON.parse(raw || '[]');
}

async function saveAll(records) {
  await fs.writeFile(DATA_FILE, JSON.stringify(records, null, 2), 'utf8');
}

function tallyByField(list, field) {
  return list.reduce((acc, item) => {
    const key = item[field] || '未填';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function buildStats(records) {
  const count = records.length;

  const likertStats = LIKERT_IDS.reduce((acc, id) => {
    let sum = 0;
    let answered = 0;
    records.forEach((r) => {
      const v = Number(r[id]);
      if (Number.isFinite(v)) {
        sum += v;
        answered += 1;
      }
    });
    acc[id] = {
      average: answered ? Number((sum / answered).toFixed(2)) : null,
      answered,
    };
    return acc;
  }, {});

  const suggestions = records
    .map((r) => (r.suggestion || '').trim())
    .filter(Boolean)
    .slice(-20)
    .reverse();

  return {
    count,
    demographics: {
      gender: tallyByField(records, 'gender'),
      age: tallyByField(records, 'age'),
      edu: tallyByField(records, 'edu'),
      tech: tallyByField(records, 'tech'),
    },
    likertStats,
    suggestions: {
      count: suggestions.length,
      latest: suggestions,
    },
    lastUpdated: new Date().toISOString(),
  };
}

let cachedStats = null;

surveyApp.post('/api/surveys', async (req, res) => {
  const payload = req.body || {};
  const errors = validatePayload(payload);
  if (errors.length) {
    return res.status(400).json({ message: '校验失败', errors });
  }

  const record = {
    ...payload,
    submittedAt: new Date().toISOString(),
  };

  try {
    const all = await readAll();
    all.push(record);
    await saveAll(all);
    cachedStats = buildStats(all);
    return res.status(201).json({ message: '提交成功' });
  } catch (err) {
    console.error('写入失败', err);
    return res.status(500).json({ message: '存储失败，请稍后重试' });
  }
});

// 统计接口仅在 1145 暴露
statsApp.get('/api/stats', async (_req, res) => {
  try {
    if (!cachedStats) {
      const all = await readAll();
      cachedStats = buildStats(all);
    }
    return res.json(cachedStats);
  } catch (err) {
    console.error('统计失败', err);
    return res.status(500).json({ message: '统计生成失败' });
  }
});

// 预加载统计数据，避免第一次请求延迟，然后同时启动两个端口
readAll()
  .then((data) => {
    cachedStats = buildStats(data);
  })
  .catch((err) => {
    console.warn('初始统计预加载失败', err);
  })
  .finally(() => {
    surveyApp.listen(SURVEY_PORT, () => {
      console.log(`Survey app running at http://localhost:${SURVEY_PORT}`);
    });
    statsApp.listen(STATS_PORT, () => {
      console.log(`Stats app running at http://localhost:${STATS_PORT}`);
    });
  });
