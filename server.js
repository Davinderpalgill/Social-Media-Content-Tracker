const express = require('express');
const path    = require('path');
const crypto  = require('crypto');
const { Pool } = require('pg');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Auth ──────────────────────────────────────────────────────────────────────
// Set APP_USER / APP_PASS env vars to change credentials (defaults shown below).
const APP_USER   = process.env.APP_USER || 'admin';
const APP_PASS   = process.env.APP_PASS || 'truyerba123';
const SESSION_MS = 8 * 60 * 60 * 1000; // 8 hours
const sessions   = new Map(); // token -> expiry

function hashPass(p) { return crypto.createHash('sha256').update(p).digest('hex'); }
function newSession() {
  const t = crypto.randomBytes(32).toString('hex');
  sessions.set(t, Date.now() + SESSION_MS);
  return t;
}
function getSessionToken(req) {
  const m = (req.headers.cookie || '').match(/session=([a-f0-9]+)/);
  return m ? m[1] : null;
}
function validSession(req) {
  const t = getSessionToken(req);
  if (!t) return false;
  const exp = sessions.get(t);
  if (!exp || Date.now() > exp) { sessions.delete(t); return false; }
  return true;
}

// Auth guard — applied to all /api/ routes except /api/login and /api/logout
function authGuard(req, res, next) {
  if (!req.path.startsWith('/api/')) return next();
  if (req.path === '/api/login' || req.path === '/api/logout') return next();
  if (!validSession(req)) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ── Database ──────────────────────────────────────────────────────────────────
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

    CREATE TABLE IF NOT EXISTS influencer_collabs (
      id                  VARCHAR(60)    PRIMARY KEY,
      influencer_name     VARCHAR(255)   NOT NULL,
      handle              VARCHAR(255),
      platform            VARCHAR(50)    DEFAULT 'Instagram',
      follower_count      INTEGER        DEFAULT 0,
      tier                VARCHAR(20)    DEFAULT 'micro',
      email               VARCHAR(255),
      phone               VARCHAR(100),
      collab_type         VARCHAR(20)    DEFAULT 'paid',
      total_amount        NUMERIC(12,2)  DEFAULT 0,
      payment_status      VARCHAR(20)    DEFAULT 'unpaid',
      amount_paid         NUMERIC(12,2)  DEFAULT 0,
      payment_date        DATE,
      invoice_received    BOOLEAN        DEFAULT false,
      product_included    TEXT,
      parcel_status       VARCHAR(30)    DEFAULT 'not_required',
      parcel_tracking     VARCHAR(255),
      parcel_sent_date    DATE,
      script_type         VARCHAR(30)    DEFAULT 'self_generated',
      script_status       VARCHAR(30)    DEFAULT 'not_started',
      script_link         TEXT,
      total_reels         INTEGER        DEFAULT 1,
      reels_done          INTEGER        DEFAULT 0,
      content_review      VARCHAR(30)    DEFAULT 'not_submitted',
      post_link           TEXT,
      content_published   BOOLEAN        DEFAULT false,
      published_date      DATE,
      published_platforms TEXT,
      subscription_type   VARCHAR(30)    DEFAULT 'one_time',
      subscription_active BOOLEAN        DEFAULT false,
      subscription_months INTEGER        DEFAULT 0,
      subscription_start  DATE,
      subscription_end    DATE,
      next_delivery_date  DATE,
      contract_signed     BOOLEAN        DEFAULT false,
      contract_date       DATE,
      notes               TEXT,
      date_added          DATE           DEFAULT CURRENT_DATE,
      created_at          TIMESTAMPTZ    DEFAULT NOW(),
      updated_at          TIMESTAMPTZ    DEFAULT NOW()
    );
  `);

  // ── Migrate: add publish columns to contents ─────────────────────────────
  await pool.query(`
    ALTER TABLE contents
      ADD COLUMN IF NOT EXISTS publish_status      VARCHAR(20)  DEFAULT 'unpublished',
      ADD COLUMN IF NOT EXISTS published_platforms TEXT,
      ADD COLUMN IF NOT EXISTS published_date      TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS scheduled_date      DATE;
  `);

  // ── Migrate: add content_plans table ────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS content_plans (
      id                  VARCHAR(60)   PRIMARY KEY,
      title               VARCHAR(255)  NOT NULL,
      content_type        VARCHAR(50)   DEFAULT 'other',
      description         TEXT,
      creator             VARCHAR(255),
      linked_post_id      VARCHAR(60),
      -- Instagram
      ig_status           VARCHAR(20)   DEFAULT 'draft',
      ig_scheduled        DATE,
      ig_published        DATE,
      ig_link             TEXT,
      ig_notes            TEXT,
      -- Blog
      blog_status         VARCHAR(20)   DEFAULT 'draft',
      blog_scheduled      DATE,
      blog_published      DATE,
      blog_link           TEXT,
      blog_notes          TEXT,
      -- LinkedIn
      li_status           VARCHAR(20)   DEFAULT 'draft',
      li_scheduled        DATE,
      li_published        DATE,
      li_link             TEXT,
      li_notes            TEXT,
      -- YouTube
      yt_status           VARCHAR(20)   DEFAULT 'draft',
      yt_scheduled        DATE,
      yt_published        DATE,
      yt_link             TEXT,
      yt_notes            TEXT,
      created_at          TIMESTAMPTZ   DEFAULT NOW(),
      updated_at          TIMESTAMPTZ   DEFAULT NOW()
    );
  `);

  // ── Migrate: add vendors table ───────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vendors (
      id                VARCHAR(60)    PRIMARY KEY,
      name              VARCHAR(255)   NOT NULL,
      category          VARCHAR(50)    DEFAULT 'other',
      contact_person    VARCHAR(255),
      phone             VARCHAR(100),
      email             VARCHAR(255),
      invoice_number    VARCHAR(100),
      invoice_amount    NUMERIC(12,2)  DEFAULT 0,
      gst_amount        NUMERIC(12,2)  DEFAULT 0,
      amount_paid       NUMERIC(12,2)  DEFAULT 0,
      payment_status    VARCHAR(20)    DEFAULT 'unpaid',
      due_date          DATE,
      payment_date      DATE,
      po_reference      VARCHAR(100),
      bank_name         VARCHAR(255),
      account_number    VARCHAR(100),
      ifsc_code         VARCHAR(20),
      delivery_status   VARCHAR(30)    DEFAULT 'pending',
      delivery_date     DATE,
      notes             TEXT,
      date_added        DATE           DEFAULT CURRENT_DATE,
      created_at        TIMESTAMPTZ    DEFAULT NOW(),
      updated_at        TIMESTAMPTZ    DEFAULT NOW()
    );
  `);

  // Seed default categories only on first run
  const { rows } = await pool.query('SELECT COUNT(*) FROM categories');
  if (parseInt(rows[0].count) === 0) {
    for (const c of DEFAULT_CATEGORIES) {
      await pool.query(
        `INSERT INTO categories (id, name, icon, type, is_default) VALUES ($1,$2,$3,$4,true)`,
        [c.id, c.name, c.icon, c.type]
      );
    }
    console.log('Default categories seeded.');
  }
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(authGuard);

// ── Mappers ───────────────────────────────────────────────────────────────────
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
function mapInvestor(r) {
  return {
    id:r.id, name:r.name, platform:r.platform,
    profileUrl:r.profile_url, investorType:r.investor_type,
    location:r.location, status:r.status, priority:r.priority,
    firstContact:r.first_contact, lastContact:r.last_contact,
    nextFollowup:r.next_followup, followupCount:r.followup_count,
    messageSent:r.message_sent, replyContent:r.reply_content,
    investmentRange:r.investment_range, notes:r.notes,
    createdAt:r.created_at, updatedAt:r.updated_at,
  };
}
function mapInfluencerCollab(r) {
  return {
    id: r.id, influencerName: r.influencer_name, handle: r.handle,
    platform: r.platform, followerCount: r.follower_count, tier: r.tier,
    email: r.email, phone: r.phone,
    collabType: r.collab_type, totalAmount: r.total_amount,
    paymentStatus: r.payment_status, amountPaid: r.amount_paid,
    paymentDate: r.payment_date, invoiceReceived: r.invoice_received,
    productIncluded: r.product_included,
    parcelStatus: r.parcel_status, parcelTracking: r.parcel_tracking,
    parcelSentDate: r.parcel_sent_date,
    scriptType: r.script_type, scriptStatus: r.script_status,
    scriptLink: r.script_link,
    totalReels: r.total_reels, reelsDone: r.reels_done,
    contentReview: r.content_review, postLink: r.post_link,
    contentPublished: r.content_published, publishedDate: r.published_date,
    publishedPlatforms: r.published_platforms,
    subscriptionType: r.subscription_type, subscriptionActive: r.subscription_active,
    subscriptionMonths: r.subscription_months, subscriptionStart: r.subscription_start,
    subscriptionEnd: r.subscription_end, nextDeliveryDate: r.next_delivery_date,
    contractSigned: r.contract_signed, contractDate: r.contract_date,
    notes: r.notes, dateAdded: r.date_added,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

// ── API: Login / Logout ───────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username === APP_USER && hashPass(password) === hashPass(APP_PASS)) {
    const token = newSession();
    res.setHeader('Set-Cookie', `session=${token}; HttpOnly; Path=/; Max-Age=${SESSION_MS / 1000}; SameSite=Strict`);
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Invalid username or password' });
});

app.post('/api/logout', (req, res) => {
  const t = getSessionToken(req);
  if (t) sessions.delete(t);
  res.setHeader('Set-Cookie', 'session=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});

// ── API: Categories ───────────────────────────────────────────────────────────
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

// ── API: Contents ─────────────────────────────────────────────────────────────
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
      [c.id, c.categoryId, c.title, c.provider,
       c.driveLink||null, c.thumbnailUrl||null,
       c.paymentStatus||'unpaid', c.amount||0, c.dateAdded||null,
       c.notes||null, c.modelName||null, c.influencerName||null,
       c.price||null, c.productIncluded||null,
       c.publishStatus||'unpublished', c.publishedPlatforms||null,
       c.publishedDate||null, c.scheduledDate||null]
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
      [c.categoryId, c.title, c.provider,
       c.driveLink||null, c.thumbnailUrl||null,
       c.paymentStatus||'unpaid', c.amount||0, c.dateAdded||null,
       c.notes||null, c.modelName||null, c.influencerName||null,
       c.price||null, c.productIncluded||null,
       c.publishStatus||'unpublished', c.publishedPlatforms||null,
       c.publishedDate||null, c.scheduledDate||null, req.params.id]
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
      [v.id, v.name, v.platform||'LinkedIn', v.profileUrl||null,
       v.investorType||'Individual', v.location||null, v.status||'cold',
       v.priority||'medium', v.firstContact||null, v.lastContact||null,
       v.nextFollowup||null, v.messageSent||null, v.replyContent||null,
       v.investmentRange||null, v.notes||null]
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
      [v.name, v.platform||'LinkedIn', v.profileUrl||null,
       v.investorType||'Individual', v.location||null, v.status||'cold',
       v.priority||'medium', v.firstContact||null, v.lastContact||null,
       v.nextFollowup||null, v.messageSent||null, v.replyContent||null,
       v.investmentRange||null, v.notes||null, req.params.id]
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
      [nextFollowup||null, req.params.id]
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

// ── API: Influencer Collabs ───────────────────────────────────────────────────
app.get('/api/influencer-collabs', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM influencer_collabs ORDER BY created_at DESC');
    res.json(rows.map(mapInfluencerCollab));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/influencer-collabs', async (req, res) => {
  try {
    const c = req.body;
    await pool.query(
      `INSERT INTO influencer_collabs
         (id,influencer_name,handle,platform,follower_count,tier,email,phone,
          collab_type,total_amount,payment_status,amount_paid,payment_date,invoice_received,
          product_included,parcel_status,parcel_tracking,parcel_sent_date,
          script_type,script_status,script_link,
          total_reels,reels_done,content_review,post_link,content_published,
          published_date,published_platforms,
          subscription_type,subscription_active,subscription_months,
          subscription_start,subscription_end,next_delivery_date,
          contract_signed,contract_date,notes,date_added)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
               $19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,
               $35,$36,$37,$38)`,
      [c.id, c.influencerName, c.handle||null, c.platform||'Instagram',
       c.followerCount||0, c.tier||'micro', c.email||null, c.phone||null,
       c.collabType||'paid', c.totalAmount||0, c.paymentStatus||'unpaid',
       c.amountPaid||0, c.paymentDate||null, c.invoiceReceived||false,
       c.productIncluded||null, c.parcelStatus||'not_required',
       c.parcelTracking||null, c.parcelSentDate||null,
       c.scriptType||'self_generated', c.scriptStatus||'not_started',
       c.scriptLink||null,
       c.totalReels||1, c.reelsDone||0, c.contentReview||'not_submitted',
       c.postLink||null, c.contentPublished||false,
       c.publishedDate||null, c.publishedPlatforms||null,
       c.subscriptionType||'one_time', c.subscriptionActive||false,
       c.subscriptionMonths||0, c.subscriptionStart||null,
       c.subscriptionEnd||null, c.nextDeliveryDate||null,
       c.contractSigned||false, c.contractDate||null,
       c.notes||null, c.dateAdded||null]
    );
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/influencer-collabs/:id', async (req, res) => {
  try {
    const c = req.body;
    await pool.query(
      `UPDATE influencer_collabs SET
         influencer_name=$1,handle=$2,platform=$3,follower_count=$4,tier=$5,
         email=$6,phone=$7,collab_type=$8,total_amount=$9,payment_status=$10,
         amount_paid=$11,payment_date=$12,invoice_received=$13,product_included=$14,
         parcel_status=$15,parcel_tracking=$16,parcel_sent_date=$17,
         script_type=$18,script_status=$19,script_link=$20,
         total_reels=$21,reels_done=$22,content_review=$23,post_link=$24,
         content_published=$25,published_date=$26,published_platforms=$27,
         subscription_type=$28,subscription_active=$29,subscription_months=$30,
         subscription_start=$31,subscription_end=$32,next_delivery_date=$33,
         contract_signed=$34,contract_date=$35,notes=$36,date_added=$37,
         updated_at=NOW()
       WHERE id=$38`,
      [c.influencerName, c.handle||null, c.platform||'Instagram',
       c.followerCount||0, c.tier||'micro', c.email||null, c.phone||null,
       c.collabType||'paid', c.totalAmount||0, c.paymentStatus||'unpaid',
       c.amountPaid||0, c.paymentDate||null, c.invoiceReceived||false,
       c.productIncluded||null, c.parcelStatus||'not_required',
       c.parcelTracking||null, c.parcelSentDate||null,
       c.scriptType||'self_generated', c.scriptStatus||'not_started',
       c.scriptLink||null,
       c.totalReels||1, c.reelsDone||0, c.contentReview||'not_submitted',
       c.postLink||null, c.contentPublished||false,
       c.publishedDate||null, c.publishedPlatforms||null,
       c.subscriptionType||'one_time', c.subscriptionActive||false,
       c.subscriptionMonths||0, c.subscriptionStart||null,
       c.subscriptionEnd||null, c.nextDeliveryDate||null,
       c.contractSigned||false, c.contractDate||null,
       c.notes||null, c.dateAdded||null, req.params.id]
    );
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/influencer-collabs/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM influencer_collabs WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── API: Content Plans ────────────────────────────────────────────────────────
function fmtDate(d) { if (!d) return null; if (d instanceof Date) return d.toISOString().slice(0, 10); return String(d).slice(0, 10); }
function mapPlan(r) {
  return {
    id: r.id, title: r.title, contentType: r.content_type,
    description: r.description, creator: r.creator, linkedPostId: r.linked_post_id,
    instagram: { status: r.ig_status, scheduled: fmtDate(r.ig_scheduled), published: fmtDate(r.ig_published), link: r.ig_link, notes: r.ig_notes },
    blog:      { status: r.blog_status, scheduled: fmtDate(r.blog_scheduled), published: fmtDate(r.blog_published), link: r.blog_link, notes: r.blog_notes },
    linkedin:  { status: r.li_status, scheduled: fmtDate(r.li_scheduled), published: fmtDate(r.li_published), link: r.li_link, notes: r.li_notes },
    youtube:   { status: r.yt_status, scheduled: fmtDate(r.yt_scheduled), published: fmtDate(r.yt_published), link: r.yt_link, notes: r.yt_notes },
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
app.get('/api/content-plans', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM content_plans ORDER BY created_at DESC');
    res.json(rows.map(mapPlan));
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/content-plans', async (req, res) => {
  try {
    const p = req.body;
    const ig = p.instagram||{}, bl = p.blog||{}, li = p.linkedin||{}, yt = p.youtube||{};
    await pool.query(
      `INSERT INTO content_plans
         (id,title,content_type,description,creator,linked_post_id,
          ig_status,ig_scheduled,ig_published,ig_link,ig_notes,
          blog_status,blog_scheduled,blog_published,blog_link,blog_notes,
          li_status,li_scheduled,li_published,li_link,li_notes,
          yt_status,yt_scheduled,yt_published,yt_link,yt_notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
      [p.id, p.title, p.contentType||'other', p.description||null, p.creator||null, p.linkedPostId||null,
       ig.status||'draft', ig.scheduled||null, ig.published||null, ig.link||null, ig.notes||null,
       bl.status||'draft', bl.scheduled||null, bl.published||null, bl.link||null, bl.notes||null,
       li.status||'draft', li.scheduled||null, li.published||null, li.link||null, li.notes||null,
       yt.status||'draft', yt.scheduled||null, yt.published||null, yt.link||null, yt.notes||null]
    );
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/content-plans/:id', async (req, res) => {
  try {
    const p = req.body;
    const ig = p.instagram||{}, bl = p.blog||{}, li = p.linkedin||{}, yt = p.youtube||{};
    await pool.query(
      `UPDATE content_plans SET
         title=$1,content_type=$2,description=$3,creator=$4,linked_post_id=$5,
         ig_status=$6,ig_scheduled=$7,ig_published=$8,ig_link=$9,ig_notes=$10,
         blog_status=$11,blog_scheduled=$12,blog_published=$13,blog_link=$14,blog_notes=$15,
         li_status=$16,li_scheduled=$17,li_published=$18,li_link=$19,li_notes=$20,
         yt_status=$21,yt_scheduled=$22,yt_published=$23,yt_link=$24,yt_notes=$25,
         updated_at=NOW()
       WHERE id=$26`,
      [p.title, p.contentType||'other', p.description||null, p.creator||null, p.linkedPostId||null,
       ig.status||'draft', ig.scheduled||null, ig.published||null, ig.link||null, ig.notes||null,
       bl.status||'draft', bl.scheduled||null, bl.published||null, bl.link||null, bl.notes||null,
       li.status||'draft', li.scheduled||null, li.published||null, li.link||null, li.notes||null,
       yt.status||'draft', yt.scheduled||null, yt.published||null, yt.link||null, yt.notes||null,
       req.params.id]
    );
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/content-plans/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM content_plans WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── API: Vendors ──────────────────────────────────────────────────────────────
function mapVendor(r) {
  return {
    id: r.id, name: r.name, category: r.category,
    contactPerson: r.contact_person, phone: r.phone, email: r.email,
    invoiceNumber: r.invoice_number, invoiceAmount: r.invoice_amount,
    gstAmount: r.gst_amount, amountPaid: r.amount_paid,
    paymentStatus: r.payment_status, dueDate: r.due_date,
    paymentDate: r.payment_date, poReference: r.po_reference,
    bankName: r.bank_name, accountNumber: r.account_number,
    ifscCode: r.ifsc_code, deliveryStatus: r.delivery_status,
    deliveryDate: r.delivery_date, notes: r.notes,
    dateAdded: r.date_added, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
app.get('/api/vendors', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM vendors ORDER BY created_at DESC');
    res.json(rows.map(mapVendor));
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/vendors', async (req, res) => {
  try {
    const v = req.body;
    await pool.query(
      `INSERT INTO vendors
         (id,name,category,contact_person,phone,email,invoice_number,
          invoice_amount,gst_amount,amount_paid,payment_status,due_date,
          payment_date,po_reference,bank_name,account_number,ifsc_code,
          delivery_status,delivery_date,notes,date_added)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
      [v.id, v.name, v.category||'other', v.contactPerson||null, v.phone||null,
       v.email||null, v.invoiceNumber||null, v.invoiceAmount||0, v.gstAmount||0,
       v.amountPaid||0, v.paymentStatus||'unpaid', v.dueDate||null,
       v.paymentDate||null, v.poReference||null, v.bankName||null,
       v.accountNumber||null, v.ifscCode||null, v.deliveryStatus||'pending',
       v.deliveryDate||null, v.notes||null, v.dateAdded||null]
    );
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/vendors/:id', async (req, res) => {
  try {
    const v = req.body;
    await pool.query(
      `UPDATE vendors SET
         name=$1,category=$2,contact_person=$3,phone=$4,email=$5,
         invoice_number=$6,invoice_amount=$7,gst_amount=$8,amount_paid=$9,
         payment_status=$10,due_date=$11,payment_date=$12,po_reference=$13,
         bank_name=$14,account_number=$15,ifsc_code=$16,delivery_status=$17,
         delivery_date=$18,notes=$19,date_added=$20,updated_at=NOW()
       WHERE id=$21`,
      [v.name, v.category||'other', v.contactPerson||null, v.phone||null,
       v.email||null, v.invoiceNumber||null, v.invoiceAmount||0, v.gstAmount||0,
       v.amountPaid||0, v.paymentStatus||'unpaid', v.dueDate||null,
       v.paymentDate||null, v.poReference||null, v.bankName||null,
       v.accountNumber||null, v.ifscCode||null, v.deliveryStatus||'pending',
       v.deliveryDate||null, v.notes||null, v.dateAdded||null, req.params.id]
    );
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/vendors/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM vendors WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Export CSV ────────────────────────────────────────────────────────────────
app.get('/api/export', async (req, res) => {
  try {
    const { rows: cats }  = await pool.query('SELECT * FROM categories');
    const { rows: items } = await pool.query('SELECT * FROM contents ORDER BY created_at DESC');
    const catMap = Object.fromEntries(cats.map(c => [c.id, c.name]));
    const headers = ['Title','Provider','Category','Payment Status','Amount','Date Added',
                     'Publish Status','Published Platforms','Published Date','Scheduled Date',
                     'Drive Link','Notes','Model Name','Influencer Name','Price','Product'];
    const csvRows = [headers, ...items.map(i => [
      i.title, i.provider, catMap[i.category_id]||'',
      i.payment_status, i.amount, i.date_added,
      i.publish_status||'unpublished', i.published_platforms||'',
      i.published_date ? new Date(i.published_date).toISOString().slice(0,10) : '',
      i.scheduled_date||'',
      i.drive_link||'', i.notes||'', i.model_name||'',
      i.influencer_name||'', i.price||'', i.product_included||''
    ])];
    const csv = csvRows.map(r => r.map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');
    res.setHeader('Content-Type','text/csv');
    res.setHeader('Content-Disposition',`attachment; filename="truyerba_${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(csv);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Catch-all ─────────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────
initDB()
  .then(() => app.listen(PORT, () => console.log(`Truyerba running on port ${PORT}`)))
  .catch(err => { console.error('DB init failed:', err); process.exit(1); });
