// Simple Express backend for survey collection and stats (two ports: 80 and 1145)
const express = require('express');
const fs = require('fs/promises');
const path = require('path');

const surveyApp = express(); // 端口 1144，用于问卷填写与提交
const statsApp = express();  // 端口 1145，用于统计查看
const SURVEY_PORT = process.env.SURVEY_PORT || 1144;
const STATS_PORT = process.env.STATS_PORT || 1145;
const DATA_FILE = path.join(__dirname, 'data', 'responses.json');

// 满意度量表题目ID（Q16-Q45）
const LIKERT_IDS = [
  'Q16','Q17','Q18','Q19','Q20','Q21', // 有形性
  'Q22','Q23','Q24','Q25','Q26',       // 可靠性
  'Q27','Q28','Q29','Q30','Q31',       // 响应性
  'Q32','Q33','Q34','Q35',             // 保证性
  'Q36','Q37','Q38','Q39',             // 移情性
  'Q40','Q41','Q42','Q43','Q44',       // 文旅融合体验
  'Q45'                                 // 总体满意度
];

// 行为意向题目ID（Q46-Q47）
const INTENT_IDS = ['Q46', 'Q47'];

// 所有量表题（用于统计）
const ALL_SCALE_IDS = [...LIKERT_IDS, ...INTENT_IDS];

surveyApp.use(express.json({ limit: '1mb' }));

// 获取客户端真实 IP（支持代理）
function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim()
    || req.headers['x-real-ip']
    || req.socket?.remoteAddress
    || req.ip
    || 'unknown';
}

surveyApp.use(express.static(__dirname));

// 统计端服务
statsApp.use(express.json({ limit: '1mb' }));

// 简单的 Basic Auth 中间件
const basicAuth = (req, res, next) => {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="Stats Dashboard"');
    return res.status(401).send('需要登录');
  }
  const base64 = auth.split(' ')[1];
  const [user, pass] = Buffer.from(base64, 'base64').toString().split(':');
  if (user === 'makuraly' && pass === 'Lxy20040904.com') {
    return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Stats Dashboard"');
  return res.status(401).send('认证失败');
};

// 统计端所有页面和接口都需登录
statsApp.use(basicAuth);

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
  const errors = [];

  // 筛选题必填
  if (!payload.Q1) {
    errors.push('缺少筛选题 Q1');
    return errors;
  }

  // 如果选择"否"（未参观），则只需要Q1
  if (payload.Q1 === '否' || payload.filtered) {
    return errors; // 无需验证其他字段
  }

  // 基本信息必填字段（Q2-Q6）
  const requiredBasic = ['Q2', 'Q3', 'Q4', 'Q5', 'Q6'];
  requiredBasic.forEach((field) => {
    if (!payload[field]) {
      errors.push(`缺少必填字段: ${field}`);
    }
  });

  // 参观特征必填字段（Q8-Q15，Q10是多选）
  const requiredVisit = ['Q8', 'Q9', 'Q11', 'Q12', 'Q13', 'Q14', 'Q15'];
  requiredVisit.forEach((field) => {
    if (!payload[field]) {
      errors.push(`缺少必填字段: ${field}`);
    }
  });

  // Q10 多选题检查
  if (!payload.Q10 || (Array.isArray(payload.Q10) && payload.Q10.length === 0)) {
    errors.push('缺少必填字段: Q10（了解途径）');
  }

  // 满意度量表题验证（Q16-Q45）
  LIKERT_IDS.forEach((id) => {
    const value = Number(payload[id]);
    if (!Number.isFinite(value) || value < 1 || value > 5) {
      errors.push(`题目 ${id} 的评分无效，需为 1-5 之间的数字`);
    }
  });

  // 行为意向题验证（Q46-Q47）
  INTENT_IDS.forEach((id) => {
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
  
  // 过滤掉筛选未通过的记录
  const validRecords = records.filter(r => r.Q1 === '是' && !r.filtered);

  // 量表统计（包括满意度和行为意向）
  const likertStats = ALL_SCALE_IDS.reduce((acc, id) => {
    let sum = 0;
    let answered = 0;
    validRecords.forEach((r) => {
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

  return {
    count,
    validCount: validRecords.length,
    demographics: {
      gender: tallyByField(validRecords, 'Q2'),       // 性别
      residence: tallyByField(validRecords, 'Q3'),    // 常住地
      age: tallyByField(validRecords, 'Q4'),          // 年龄段
      education: tallyByField(validRecords, 'Q5'),    // 受教育程度
      occupation: tallyByField(validRecords, 'Q6'),   // 职业
      income: tallyByField(validRecords, 'Q7'),       // 月收入
      visitCount: tallyByField(validRecords, 'Q8'),   // 参观次数
      purpose: tallyByField(validRecords, 'Q9'),      // 参观目的
    },
    likertStats,
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
    ip: getClientIp(req),
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

// 统计接口仅在 1145 暴露，支持 startDate/endDate 筛选
statsApp.get('/api/stats', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let all = await readAll();

    // 日期筛选
    if (startDate || endDate) {
      const start = startDate ? new Date(startDate + 'T00:00:00') : null;
      const end = endDate ? new Date(endDate + 'T23:59:59') : null;
      all = all.filter((r) => {
        const t = new Date(r.submittedAt);
        if (start && t < start) return false;
        if (end && t > end) return false;
        return true;
      });
    }

    const stats = (startDate || endDate) ? buildStats(all) : (cachedStats || buildStats(all));

    // 返回提交列表（仅时间和IP）
    const submissions = all.map((r) => ({
      submittedAt: r.submittedAt,
      ip: r.ip || 'unknown',
    })).reverse().slice(0, 100);

    return res.json({ ...stats, submissions });
  } catch (err) {
    console.error('统计失败', err);
    return res.status(500).json({ message: '统计生成失败' });
  }
});

// 下载数据接口（支持 CSV 和 JSON 格式）
statsApp.get('/api/download', async (req, res) => {
  try {
    const { format = 'csv', startDate, endDate } = req.query;
    let all = await readAll();

    // 日期筛选
    if (startDate || endDate) {
      const start = startDate ? new Date(startDate + 'T00:00:00') : null;
      const end = endDate ? new Date(endDate + 'T23:59:59') : null;
      all = all.filter((r) => {
        const t = new Date(r.submittedAt);
        if (start && t < start) return false;
        if (end && t > end) return false;
        return true;
      });
    }

    const timestamp = new Date().toISOString().slice(0, 10);

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="survey-data-${timestamp}.json"`);
      return res.send(JSON.stringify(all, null, 2));
    }

    // CSV 格式
    const headers = [
      'submittedAt', 'ip', 
      'Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7',  // 基本信息
      'Q8', 'Q9', 'Q10', 'Q11', 'Q12', 'Q13', 'Q14', 'Q15',  // 参观特征
      ...ALL_SCALE_IDS,  // 量表题 Q16-Q47
      'Q48', 'Q49'  // 开放题
    ];
    const csvRows = [headers.join(',')];
    all.forEach((r) => {
      const row = headers.map((h) => {
        let val = r[h] ?? '';
        // 多选题转为分号分隔
        if (Array.isArray(val)) {
          val = val.join(';');
        }
        // 转义包含逗号或引号的值
        if (typeof val === 'string' && (val.includes(',') || val.includes('"') || val.includes('\n'))) {
          return `"${val.replace(/"/g, '""')}"`;
        }
        return val;
      });
      csvRows.push(row.join(','));
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="survey-data-${timestamp}.csv"`);
    // 添加 BOM 以支持 Excel 正确识别 UTF-8
    return res.send('\uFEFF' + csvRows.join('\n'));
  } catch (err) {
    console.error('下载失败', err);
    return res.status(500).json({ message: '下载失败' });
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
