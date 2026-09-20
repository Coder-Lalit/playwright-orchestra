import express from 'express';
import path from 'path';

const app = express();
const fixturePath = path.resolve(process.cwd(), 'tests', 'fixtures');

app.use(express.static(fixturePath));
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.listen(4173, () => {
  console.log('Dummy app listening on http://0.0.0.0:4173');
});
