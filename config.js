/* PEILGLAS — instellingen voor de browser.
   De telefoons lezen de stand van de avond rechtstreeks uit Firebase. Lokaal (localhost) speelt
   dev-server.js de database na op /__db. */
window.PG = window.PG || {};
PG.DB_URL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
  ? '/__db'
  : 'https://peilglas-default-rtdb.europe-west1.firebasedatabase.app';
