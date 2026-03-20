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

    CREATE TABLE IF NOT EXISTS investors (
      id               VARCHAR(60)    PRIMARY KEY,
      name             VARCHAR(255)   NOT NULL,
      platform         VARCHAR(50)    DEFAULT 'LinkedIn',
      profile_url      TEXT,
      investor_type    VARCHAR(50)    DEFAULT 'Individual',
      location         VARCHAR(255),
      status           VARCHAR(50)    DEFAULT 'cold',
      priority         VARCHAR(20)    DEFAULT 'medium',
      first_contact    DATE,
      last_contact     DATE,
      next_followup    DATE,
      followup_count   INTEGER        DEFAULT 0,
      message_sent     TEXT,
      reply_content    TEXT,
      investment_range VARCHAR(100),
      notes            TEXT,
      created_at       TIMESTAMPTZ    DEFAULT NOW(),
      updated_at       TIMESTAMPTZ    DEFAULT NOW()
    );
  `);

  // ── Migrate: add publish columns to existing tables ─────────────────────
  await pool.query(`
    ALTER TABLE contents
      ADD COLUMN IF NOT EXISTS publish_status      VARCHAR(20)  DEFAULT 'unpublished',
      ADD COLUMN IF NOT EXISTS published_platforms TEXT,
      ADD COLUMN IF NOT EXISTS published_date      TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS scheduled_date      DATE;
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
    publishStatus:r.publish_status, publishedPlatforms:r.published_platforms,
    publishedDate:r.published_date, scheduledDate:r.scheduled_date,
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
          model_name,influencer_name,price,product_included,
          publish_status,published_platforms,published_date,scheduled_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [ c.id, c.categoryId, c.title, c.provider,
        c.driveLink||null, c.thumbnailUrl||null,
        c.paymentStatus||'unpaid', c.amount||0, c.dateAdded||null,
        c.notes||null, c.modelName||null, c.influencerName||null,
        c.price||null, c.productIncluded||null,
        c.publishStatus||'unpublished', c.publishedPlatforms||null,
        c.publishedDate||null, c.scheduledDate||null ]
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
         product_included=$13, publish_status=$14, published_platforms=$15,
         published_date=$16, scheduled_date=$17, updated_at=NOW()
       WHERE id=$18`,
      [ c.categoryId, c.title, c.provider,
        c.driveLink||null, c.thumbnailUrl||null,
        c.paymentStatus||'unpaid', c.amount||0, c.dateAdded||null,
        c.notes||null, c.modelName||null, c.influencerName||null,
        c.price||null, c.productIncluded||null,
        c.publishStatus||'unpublished', c.publishedPlatforms||null,
        c.publishedDate||null, c.scheduledDate||null, req.params.id ]
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

app.patch('/api/contents/:id/publish', async (req, res) => {
  try {
    const { platforms, publishedDate } = req.body;
    await pool.query(
      `UPDATE contents SET publish_status='published', published_platforms=$1, published_date=$2, updated_at=NOW() WHERE id=$3`,
      [platforms||null, publishedDate||null, req.params.id]
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

// ── Helper: Investor ─────────────────────────────────────────────────────────
function mapInvestor(r) {
  return {
    id: r.id, name: r.name, platform: r.platform,
    profileUrl: r.profile_url, investorType: r.investor_type,
    location: r.location, status: r.status, priority: r.priority,
    firstContact: r.first_contact, lastContact: r.last_contact,
    nextFollowup: r.next_followup, followupCount: r.followup_count,
    messageSent: r.message_sent, replyContent: r.reply_content,
    investmentRange: r.investment_range, notes: r.notes,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

// ── API: Investors ────────────────────────────────────────────────────────────
app.get('/api/investors', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM investors ORDER BY created_at DESC');
    res.json(rows.map(mapInvestor));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/investors', async (req, res) => {
  try {
    const v = req.body;
    await pool.query(
      `INSERT INTO investors
         (id,name,platform,profile_url,investor_type,location,status,priority,
          first_contact,last_contact,next_followup,message_sent,reply_content,
          investment_range,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [ v.id, v.name, v.platform||'LinkedIn', v.profileUrl||null,
        v.investorType||'Individual', v.location||null, v.status||'cold',
        v.priority||'medium', v.firstContact||null, v.lastContact||null,
        v.nextFollowup||null, v.messageSent||null, v.replyContent||null,
        v.investmentRange||null, v.notes||null ]
    );
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/investors/:id', async (req, res) => {
  try {
    const v = req.body;
    await pool.query(
      `UPDATE investors SET
         name=$1, platform=$2, profile_url=$3, investor_type=$4, location=$5,
         status=$6, priority=$7, first_contact=$8, last_contact=$9,
         next_followup=$10, message_sent=$11, reply_content=$12,
         investment_range=$13, notes=$14, updated_at=NOW()
       WHERE id=$15`,
      [ v.name, v.platform||'LinkedIn', v.profileUrl||null,
        v.investorType||'Individual', v.location||null, v.status||'cold',
        v.priority||'medium', v.firstContact||null, v.lastContact||null,
        v.nextFollowup||null, v.messageSent||null, v.replyContent||null,
        v.investmentRange||null, v.notes||null, req.params.id ]
    );
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/investors/:id/followup', async (req, res) => {
  try {
    const { nextFollowup } = req.body;
    await pool.query(
      `UPDATE investors SET
         followup_count = followup_count + 1,
         last_contact   = CURRENT_DATE,
         next_followup  = $1,
         updated_at     = NOW()
       WHERE id = $2`,
      [ nextFollowup || null, req.params.id ]
    );
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/investors/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM investors WHERE id=$1', [req.params.id]);
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
                     'Publish Status','Published Platforms','Published Date','Scheduled Date',
                     'Drive Link','Notes','Model Name','Influencer Name','Price','Product'];
    const csvRows = [headers, ...items.map(i=>[
      i.title, i.provider, catMap[i.category_id]||'',
      i.payment_status, i.amount, i.date_added,
      i.publish_status||'unpublished', i.published_platforms||'',
      i.published_date ? new Date(i.published_date).toISOString().slice(0,10) : '',
      i.scheduled_date||'',
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
