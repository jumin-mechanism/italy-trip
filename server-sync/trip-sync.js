// 여행 앱 자동 동기화용 초소형 저장소 (Express 라우터)
// 앱이 보낸 여행 데이터(JSON)를 파일 하나로 보관하고, 두 폰이 번갈아 읽고 쓰게 해 줍니다.
// 합치기는 앱이 하고, 서버는 "누가 먼저 썼는지"만 rev 번호로 가려 줍니다.
//
// 사용 예 (server.js):
//   app.use('/api/trip-sync', require('./trip-sync')({
//     code: process.env.TRIP_SYNC_CODE,              // 16자 이상 임의 문자열
//     origins: ['https://<아이디>.github.io'],        // 앱이 열리는 주소(끝에 / 없이)
//   }));
// 앱의 "자동 동기화"에는 https://<서버>/api/trip-sync/<공간이름> 과 같은 code를 넣습니다.
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const express = require('express');

module.exports = function tripSync({ code, origins = [], dir = path.join(__dirname, 'trip-sync-data') } = {}) {
  if (typeof code !== 'string' || code.length < 16) throw new Error('trip-sync: code는 16자 이상이어야 합니다');
  const want = crypto.createHash('sha256').update(code).digest();
  const router = express.Router();
  const queue = new Map(); // 공간별로 쓰기를 한 줄로 세움

  router.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && origins.includes(origin)) {
      res.set({
        'Access-Control-Allow-Origin': origin, Vary: 'Origin',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS', 'Access-Control-Max-Age': '600',
      });
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    const got = crypto.createHash('sha256').update(String(req.headers.authorization || '').replace(/^Bearer /, '')).digest();
    if (!crypto.timingSafeEqual(got, want)) return res.sendStatus(401);
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.param('space', (req, res, next, v) => (/^[a-z0-9-]{1,40}$/.test(v) ? next() : res.sendStatus(400)));
  const file = (space) => path.join(dir, space + '.json');
  const read = async (space) => {
    try { return JSON.parse(await fs.readFile(file(space), 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  };

  router.get('/:space', async (req, res, next) => {
    try { const doc = await read(req.params.space); doc ? res.json(doc) : res.sendStatus(404); }
    catch (e) { next(e); }
  });

  router.put('/:space', express.json({ limit: '2mb' }), (req, res, next) => {
    const space = req.params.space;
    const { baseRev, data } = req.body || {};
    const ok = Number.isInteger(baseRev) && data && ['items', 'places', 'drawings'].every((k) => Array.isArray(data[k]));
    if (!ok) return res.sendStatus(400);
    const job = (queue.get(space) || Promise.resolve()).then(async () => {
      const cur = await read(space);
      if ((cur ? cur.rev : 0) !== baseRev) return res.status(409).json(cur);
      const doc = { rev: baseRev + 1, savedAt: new Date().toISOString(), data };
      await fs.mkdir(dir, { recursive: true });
      const tmp = file(space) + '.' + process.pid + '.tmp';
      await fs.writeFile(tmp, JSON.stringify(doc));
      await fs.rename(tmp, file(space));
      res.json({ rev: doc.rev });
    }).catch(next);
    queue.set(space, job);
  });

  return router;
};
