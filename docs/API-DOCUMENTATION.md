# ZGalaxy - دليل الاستخدام الشامل لـ REST API لمكائن البنية التحتية ZeroTier Planet & Moon

يوفر مشروع **ZGalaxy** التحكم التام والكامل في كافة خصائص البنية التحتية الذاتية لـ ZeroTier، مما يسمح بنقل وتدشين شبكات Planet و Moon واستضافتها ذاتياً دون أي ارتباط بالخوادم المركزية الرسمية.

---

## المصادقة والأمان (Authentication & Security)

تستخدم الـ API التوثيق عبر Bearer Token الممرر في ترويسة الطلب (`Authorization Header`).

```http
Authorization: Bearer YOUR_API_SECRET_KEY
```

---

## قائمة نقاط النهاية (Endpoints Reference)

### 1. الصحة وإحصائيات نظام ZGalaxy (Health & Metrics)

#### فحص الصحة (Health Check)
* **GET** `/api/v1/health`
* **الاستجابة:**
  ```json
  {
    "status": "ok",
    "timestamp": "2026-07-31T20:21:00.000Z",
    "version": "1.2.0",
    "service": "ZGalaxy Planet/Moon Infrastructure Engine"
  }
  ```

#### إحصائيات المحرك (Metrics)
* **GET** `/api/v1/metrics`

---

### 2. العناوين والنطاقات الديناميكية (Network & Dynamic IP Engine)

#### استكشاف العناوين الداخلية والخارجية
* **GET** `/api/v1/network/addresses`

#### تتبع ومزامنة عنوان الـ IP الديناميكي
* **GET** `/api/v1/ddns/status`
* **POST** `/api/v1/ddns/sync`

---

### 3. إدارة الـ Planet والـ Moon (Planet & Moon Operations)

* **GET** `/api/v1/planet/info`
* **POST** `/api/v1/planet/build`
* **GET** `/api/v1/planet/download`
* **GET** `/api/v1/moons`
* **POST** `/api/v1/moons/create`
* **GET** `/api/v1/moons/:id/download`
