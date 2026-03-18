const express = require('express');
const path    = require('path');
const { Pool } = require('pg');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Database ────────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

const DEFAULT_CATEGORIES = [
  { id:'cat_inf_reel',  name:'Informative Reels',     icon:'🎬', type:'default'    },
  { id:'cat_motion',    name:'Motion Graphics Reels',  icon:'✨', type:'default'    },
  { id:'cat_product',   name:'Product Photography',    icon:'📸', type:'default'    },
  { id:'cat_model',     name:'Model Reel',             icon:'👗', type:'model'      },
  { id:'cat_ai',        name:'AI Reel',                icon:'🤖', type:'default'    },
  { id:'cat_carousel',  name:'Carousel',               icon:'🔄', type:'default'    },
  { id:'cat_insta',     name:'Instagram Posts',        icon:'📱', type:'default'    },
  { id:'cat_fb',        name:'Facebook Posts',         icon:'👥', type:'default'    },
  { id:'cat_li',        name:'LinkedIn Posts',         icon:'💼', type:'default'    },
  { id:'cat_poster',    name:'Poster',                 icon:'🖼️', type:'default'    },
  { id:'cat_influencer',name:'Influencer Collabs',     icon:'🤝', type:'influencer' },
];

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id          VARCHAR(60)  PRIMARY KEY,
      name        VARCHAR(255) NOT NULL,
      icon        VARCHAR(20)  DEFAULT '📁',
      type        VARCHAR(20)  DEFAULT 'default',
      is_default  BOOLEAN      DEFAULT false,
      created_at  TIMESTAMPTZ  DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS contents (
      id               VARCHAR(60)    PRIMARY KEY,
      category_id      VARCHAR(60),
      title            VARCHAR(255)   NOT NULL,
      provider         VARCHAR(255)   NOT NULL,
      drive_link       TEXT,
      thumbnail_url    TEXT,
      payment_status   VARCHAR(20)    DEFAULT 'unpaid',
      amount           NUMERIC(12,2)  DEFAULT 0,
      date_added       DATE,
      date_paid        TIMESTAMPTZ,
      notes            TEXT,
      model_name       VARCHAR(255),
      influencer_name  VARCHAR(255),
      price            NUMERIC(12,2),
      product_included TEXT,
      created_at       TIMESTAMPTZ    DEFAULT NOW(),
      updated_at       TIMESTAMPTZ    DEFAULT NOW()
    );
  `);

  // Seed default categories only on first run
  const { rows } = await pool.query('SELECT COUNT(*) FROM categories');
  if (parseInt(rows[0].count) === 0) {
    for (const c of DEFAULT_CATEGORIES) {
      await pool.query(
        `INSERT INTO categories (id, name, icon, type, is_default)
         VALUES ($1,$2,$3,$4,true)`,
        [c.id, c.name, c.icon, c.type]
      );
    }
    console.log('Default categories seeded.');
  }
}

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Helper ───────────────────────────────────────────────────────────────────
function mapCat(r) {
  return { id:r.id, name:r.name, icon:r.icon, type:r.type,
           isDefault:r.is_default, createdAt:r.created_at };
}
function mapContent(r) {
  return {
    id:r.id, categoryId:r.category_id, title:r.title, provider:r.provider,
    driveLink:r.drive_link, thumbnailUrl:r.thumbnail_url,
    paymentStatus:r.payment_status, amount:r.amount,
    dateAdded:r.date_added, datePaid:r.date_paid, notes:r.notes,
    modelName:r.model_name, influencerName:r.influencer_name,
    price:r.price, productIncluded:r.product_included,
    createdAt:r.created_at, updatedAt:r.updated_at,
  };
}

// ── API: Categories ──────────────────────────────────────────────────────────
app.get('/api/categories', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM categories ORDER BY created_at ASC');
    res.json(rows.map(mapCat));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/categories', async (req, res) => {
  try {
    const { id, name, icon, type } = req.body;
    await pool.query(
      `INSERT INTO categories (id,name,icon,type,is_default) VALUES ($1,$2,$3,$4,false)`,
      [id, name, icon||'📁', type||'default']
    );
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/categories/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM contents   WHERE category_id=$1', [req.params.id]);
    await pool.query('DELETE FROM categories WHERE id=$1 AND is_default=false', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── API: Contents ────────────────────────────────────────────────────────────
app.get('/api/contents', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM contents ORDER BY created_at DESC');
    res.json(rows.map(mapContent));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/contents', async (req, res) => {
  try {
    const c = req.body;
    await pool.query(
      `INSERT INTO contents
         (id,category_id,title,provider,drive_link,thumbnail_url,
          payment_status,amount,date_added,notes,
          model_name,influencer_name,price,product_included)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [ c.id, c.categoryId, c.title, c.provider,
        c.driveLink||null, c.thumbnailUrl||null,
        c.paymentStatus||'unpaid', c.amount||0, c.dateAdded||null,
        c.notes||null, c.modelName||null, c.influencerName||null,
        c.price||null, c.productIncluded||null ]
    );
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/contents/:id', async (req, res) => {
  try {
    const c = req.body;
    await pool.query(
      `UPDATE contents SET
         category_id=$1, title=$2, provider=$3, drive_link=$4,
         thumbnail_url=$5, payment_status=$6, amount=$7, date_added=$8,
         notes=$9, model_name=$10, influencer_name=$11, price=$12,
         product_included=$13, updated_at=NOW()
       WHERE id=$14`,
      [ c.categoryId, c.title, c.provider,
        c.driveLink||null, c.thumbnailUrl||null,
        c.paymentStatus||'unpaid', c.amount||0, c.dateAdded||null,
        c.notes||null, c.modelName||null, c.influencerName||null,
        c.price||null, c.productIncluded||null, req.params.id ]
    );
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/contents/:id/pay', async (req, res) => {
  try {
    await pool.query(
      `UPDATE contents SET payment_status='paid', date_paid=NOW(), updated_at=NOW() WHERE id=$1`,
      [req.params.id]
    );
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/contents/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM contents WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Export CSV ───────────────────────────────────────────────────────────────
app.get('/api/export', async (req, res) => {
  try {
    const { rows: cats } = await pool.query('SELECT * FROM categories');
    const { rows: items } = await pool.query('SELECT * FROM contents ORDER BY created_at DESC');
    const catMap = Object.fromEntries(cats.map(c=>[c.id, c.name]));
    const headers = ['Title','Provider','Category','Payment Status','Amount','Date Added',
                     'Drive Link','Notes','Model Name','Influencer Name','Price','Product'];
    const csvRows = [headers, ...items.map(i=>[
      i.title, i.provider, catMap[i.category_id]||'',
      i.payment_status, i.amount, i.date_added,
      i.drive_link||'', i.notes||'', i.model_name||'',
      i.influencer_name||'', i.price||'', i.product_included||''
    ])];
    const csv = csvRows.map(r=>r.map(v=>`"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');
    res.setHeader('Content-Type','text/csv');
    res.setHeader('Content-Disposition',`attachment; filename="truyerba_${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(csv);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Catch-all ────────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ────────────────────────────────────────────────────────────────────
initDB()
  .then(() => app.listen(PORT, () => console.log(`Truyerba running on port ${PORT}`)))
  .catch(err => { console.error('DB init failed:', err); process.exit(1); });
