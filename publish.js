// Publicador automático de Instagram para el Calendario SEEDS.
// Corre cada 15 minutos vía GitHub Actions (ver .github/workflows/publish.yml).
// Busca posteos con publishStatus === 'scheduled' y scheduledAt vencido, los publica
// en Instagram y actualiza el posteo en Firestore con el resultado.

var admin = require('firebase-admin');

var serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
var IG_USER_ID = process.env.IG_USER_ID;
var IG_ACCESS_TOKEN = process.env.IG_ACCESS_TOKEN;
var GRAPH = 'https://graph.facebook.com/v21.0';

if (!serviceAccountJson || !IG_USER_ID || !IG_ACCESS_TOKEN) {
  console.error('Faltan variables de entorno (FIREBASE_SERVICE_ACCOUNT, IG_USER_ID, IG_ACCESS_TOKEN).');
  process.exit(1);
}

var serviceAccount = JSON.parse(serviceAccountJson);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
var db = admin.firestore();

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function igCreateContainer(mediaUrl, isVideo, caption, isCarouselItem) {
  var params = new URLSearchParams({ access_token: IG_ACCESS_TOKEN });
  if (caption) params.set('caption', caption);
  if (isCarouselItem) params.set('is_carousel_item', 'true');
  if (isVideo) {
    params.set('media_type', isCarouselItem ? 'VIDEO' : 'REELS');
    params.set('video_url', mediaUrl);
  } else {
    params.set('image_url', mediaUrl);
  }
  return fetch(GRAPH + '/' + IG_USER_ID + '/media?' + params.toString(), { method: 'POST' })
    .then(function (res) { return res.json(); })
    .then(function (body) {
      if (body.error) throw new Error(body.error.message);
      return body.id;
    });
}

function igCreateCarouselContainer(childIds, caption) {
  var params = new URLSearchParams({
    media_type: 'CAROUSEL',
    children: childIds.join(','),
    access_token: IG_ACCESS_TOKEN
  });
  if (caption) params.set('caption', caption);
  return fetch(GRAPH + '/' + IG_USER_ID + '/media?' + params.toString(), { method: 'POST' })
    .then(function (res) { return res.json(); })
    .then(function (body) {
      if (body.error) throw new Error(body.error.message);
      return body.id;
    });
}

function waitUntilReady(creationId) {
  var maxTries = 24; // hasta ~2 minutos (video puede tardar en procesar)
  var attempt = 0;
  function check() {
    attempt++;
    return fetch(GRAPH + '/' + creationId + '?fields=status_code&access_token=' + IG_ACCESS_TOKEN)
      .then(function (res) { return res.json(); })
      .then(function (body) {
        if (body.error) throw new Error(body.error.message);
        if (body.status_code === 'FINISHED') return true;
        if (body.status_code === 'ERROR') throw new Error('Instagram no pudo procesar el archivo.');
        if (attempt >= maxTries) throw new Error('Tiempo de espera agotado procesando el archivo en Instagram.');
        return sleep(5000).then(check);
      });
  }
  return check();
}

function igPublish(creationId) {
  var params = new URLSearchParams({ creation_id: creationId, access_token: IG_ACCESS_TOKEN });
  return fetch(GRAPH + '/' + IG_USER_ID + '/media_publish?' + params.toString(), { method: 'POST' })
    .then(function (res) { return res.json(); })
    .then(function (body) {
      if (body.error) throw new Error(body.error.message);
      return body.id;
    });
}

function igGetPermalink(mediaId) {
  return fetch(GRAPH + '/' + mediaId + '?fields=permalink&access_token=' + IG_ACCESS_TOKEN)
    .then(function (res) { return res.json(); })
    .then(function (body) { return body.permalink || ''; })
    .catch(function () { return ''; });
}

function publishSingle(mediaItem, caption) {
  var isVideo = !!(mediaItem.contentType && mediaItem.contentType.indexOf('video') === 0);
  return igCreateContainer(mediaItem.url, isVideo, caption, false)
    .then(function (creationId) { return waitUntilReady(creationId).then(function () { return creationId; }); });
}

function publishCarousel(items, caption) {
  var childIds = [];
  var chain = Promise.resolve();
  items.forEach(function (mediaItem) {
    chain = chain.then(function () {
      var isVideo = !!(mediaItem.contentType && mediaItem.contentType.indexOf('video') === 0);
      return igCreateContainer(mediaItem.url, isVideo, null, true).then(function (childId) {
        return waitUntilReady(childId).then(function () { childIds.push(childId); });
      });
    });
  });
  return chain.then(function () {
    return igCreateCarouselContainer(childIds, caption);
  }).then(function (carouselId) {
    return waitUntilReady(carouselId).then(function () { return carouselId; });
  });
}

function publishOne(doc) {
  var data = doc.data();
  var indices = Array.isArray(data.publishMediaIndices) && data.publishMediaIndices.length
    ? data.publishMediaIndices
    : [typeof data.publishMediaIndex === 'number' ? data.publishMediaIndex : 0];
  indices = indices.slice(0, 10);
  var items = indices.map(function (i) { return (data.mediaIds || [])[i]; }).filter(function (x) { return x && x.url; });
  if (!items.length) {
    return doc.ref.update({ publishStatus: 'failed', publishError: 'No hay ningún archivo cargado para publicar.' });
  }
  var caption = [data.copyFinal, data.hashtags].filter(Boolean).join('\n\n');
  var creationPromise = items.length > 1 ? publishCarousel(items, caption) : publishSingle(items[0], caption);

  return creationPromise
    .then(function (creationId) { return igPublish(creationId); })
    .then(function (publishedId) {
      return igGetPermalink(publishedId).then(function (permalink) {
        return doc.ref.update({
          status: 'Publicado',
          publishStatus: 'published',
          igMediaId: publishedId,
          igPermalink: permalink,
          publishedAt: new Date().toISOString(),
          publishError: ''
        });
      });
    })
    .catch(function (err) {
      console.error('Error publicando', doc.id, err.message);
      return doc.ref.update({ publishStatus: 'failed', publishError: String(err.message || err) });
    });
}

function main() {
  var nowIso = new Date().toISOString();
  return db.collection('posts').get().then(function (snap) {
    var due = snap.docs.filter(function (doc) {
      var d = doc.data();
      return d.publishStatus === 'scheduled' && d.scheduledAt && d.scheduledAt <= nowIso;
    });
    if (!due.length) {
      console.log('Nada para publicar por ahora.');
      return;
    }
    console.log('Publicando ' + due.length + ' posteo(s)...');
    var chain = Promise.resolve();
    due.forEach(function (doc) {
      chain = chain.then(function () {
        console.log('-> ' + doc.id);
        return publishOne(doc);
      });
    });
    return chain;
  });
}

main()
  .then(function () { console.log('Listo.'); process.exit(0); })
  .catch(function (err) { console.error('Error general:', err); process.exit(1); });
