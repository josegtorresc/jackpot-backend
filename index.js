const express = require('express');
const app = express();
const PORT = process.env.PORT || 5000;
const httpServer = require('http').createServer(app);
const firebaseAdmin = require('firebase-admin');
const cron = require('node-cron');
const cors = require('cors');
require('dotenv').config();

const privateKey = process.env.PRIVATE_KEY || "";
const formattedPrivateKey = privateKey.replace(/\\n/g, '\n');

firebaseAdmin.initializeApp({
  credential: firebaseAdmin.credential.cert({
    type: process.env.TYPE,
    project_id: process.env.PROJECT_ID,
    private_key_id: process.env.PRIVATE_KEY_ID,
    private_key: formattedPrivateKey,
    client_email: process.env.CLIENT_EMAIL,
    client_id: process.env.CLIENT_ID,
    auth_uri: process.env.AUTH_URI,
    token_uri: process.env.TOKEN_URI,
    auth_provider_x509_cert_url: process.env.AUTH_PROVIDER_X509_CERT_URL,
    client_x509_cert_url: process.env.CLIENT_X509_CERT_URL,
  }),
  databaseURL: 'https://apiabmjackpots-default-rtdb.firebaseio.com',
});

const db = firebaseAdmin.firestore();
const io = require('socket.io')(httpServer, {
  cors: {
    origin: 'http://localhost:3000',
    methods: ['GET', 'POST'],
  },
});

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

app.use(express.json());
app.use(cors());

let jackpots = {};
let jackpotsMap = new Map();

const initializeJackpots = async () => {
  try {
    const snapshot = await db.collection('jackpots').get();
    snapshot.forEach((doc) => {
      const jackpotData = doc.data();
      jackpots[doc.id] = jackpotData;
      jackpotsMap.set(jackpotData.nombre, doc.id);
    });
    console.log('Jackpots inicializados:', jackpots);
  } catch (error) {
    console.error('Error al inicializar los jackpots:', error);
  }
};

//Ruta notificaciones
app.post('/api/notifications', async (req, res) => {
  const { text, date, img } = req.body;
  console.log('Datos recibidos:', { text, date, img });

  const newNotification = {
    text,
    date,
    img,
  };

  try {
    const docRef = await db.collection('notifications').add(newNotification);
    res.status(201).json({ id: docRef.id, ...newNotification });
  } catch (error) {
    console.error('Error al agregar la notificación:', error);
    res.status(500).json({ error: 'Error al agregar la notificación' });
  }
});

app.get('/api/notifications', async (req, res) => {
  try {
    const snapshot = await db.collection('notifications').get();
    const notifications = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    res.json(notifications);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener las notificaciones' });
  }
});

app.delete('/api/notifications/:id', async (req, res) => {
  const { id } = req.params;

  try {
    await db.collection('notifications').doc(id).delete();
    res.json({ message: 'Notificación eliminada correctamente' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar la notificación' });
  }
});

app.post('/reports', async (req, res) => {
  const { userName, report, date } = req.body;

  if (!userName || !report || !date) {
    return res.status(400).send('Faltan datos');
  }

  const newReport = {
    userName,
    report,
    date,
    timestamp: admin.firestore.Timestamp.now(),
  };

  try {
    await db.collection('reports').add(newReport);
    console.log(`Reporte recibido: ${userName} - ${report}`);
    res.status(200).send('Reporte recibido');
  } catch (error) {
    console.error('Error al guardar el reporte en Firestore:', error);
    res.status(500).send('Error al guardar el reporte');
  }
});

app.get('/reports', async (req, res) => {
  try {
    const snapshot = await db.collection('reports').get();
    const reports = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    res.json(reports);
  } catch (error) {
    console.error('Error al obtener los reportes de Firestore:', error);
    res.status(500).send('Error al obtener los reportes');
  }
});

//Ruta Jackpots (En general)

app.post('/api/jackpots', async (req, res) => {
  const { nombre, trigger, monto, idAutomatico, idCasino, idMaquina, avatar } =
    req.body;

  if (jackpots[nombre]) {
    return res.status(400).json({ error: 'Jackpot con ese nombre ya existe' });
  }

  const newJackpot = {
    nombre,
    amount: parseFloat(monto),
    maxAmount: parseFloat(trigger),
    active: true,
    contributions: 0,
    idAutomatico,
    idCasino,
    idMaquina,
  };

  try {
    await db.collection('jackpots').doc(idAutomatico).set(newJackpot);

    res.status(201).json({
      message: 'Jackpot creado correctamente',
      jackpot: newJackpot,
    });
  } catch (error) {
    if (error.code === 'RESOURCE_EXHAUSTED') {
      res.status(429).json({ error: 'Quota exceeded, please try again later' });
    } else {
      res.status(500).json({ error: 'Error al crear el jackpot' });
    }
  }
});

app.get('/api/jackpots/count', (req, res) => {
  const jackpotCount = Object.keys(jackpots).length;
  console.log(`Cantidad de jackpots en el sistema: ${jackpotCount}`);
  res.json({ count: jackpotCount });
});

app.put('/api/jackpots/:id', async (req, res) => {
  const { id } = req.params;
  const formData = req.body;

  try {
    const jackpotRef = db.collection('jackpots').doc(id);
    const doc = await jackpotRef.get();

    if (!doc.exists) {
      return res
        .status(404)
        .json({ error: `Jackpot con ID ${id} no encontrado` });
    }

    await jackpotRef.update(formData);
    res.json({ message: `Jackpot con ID ${id} actualizado correctamente` });
  } catch (error) {
    if (error.code === 'RESOURCE_EXHAUSTED') {
      res.status(429).json({ error: 'Quota exceeded, please try again later' });
    } else {
      res.status(500).json({ error: 'Error al actualizar el jackpot' });
    }
  }
});

app.post('/api/updateJackpotAmount/:type', async (req, res) => {
  const { amount } = req.body;
  let { type } = req.params;

  type = decodeURIComponent(type);

  if (jackpots[type]) {
    jackpots[type].amount = parseFloat(amount);
    try {
      await db
        .collection('jackpots')
        .doc(type)
        .update({ amount: parseFloat(amount) });
      res.json({ message: `Monto de ${type} actualizado correctamente` });
    } catch (error) {
      if (error.code === 'RESOURCE_EXHAUSTED') {
        res
          .status(429)
          .json({ error: 'Quota exceeded, please try again later' });
      } else {
        res
          .status(500)
          .json({ error: 'Error al actualizar el monto del jackpot' });
      }
    }
  } else {
    res.status(404).json({ error: `Jackpot ${type} no encontrado` });
  }
});

app.post('/api/updateJackpotTrigger/:type', async (req, res) => {
  const { type } = req.params;
  const { triggerAmount } = req.body;

  if (jackpots[type]) {
    jackpots[type].maxAmount = parseFloat(triggerAmount);
    try {
      await db
        .collection('jackpots')
        .doc(type)
        .update({ maxAmount: parseFloat(triggerAmount) });
      res.json({ message: `Trigger de ${type} actualizado correctamente` });
    } catch (error) {
      if (error.code === 'RESOURCE_EXHAUSTED') {
        res
          .status(429)
          .json({ error: 'Quota exceeded, please try again later' });
      } else {
        res
          .status(500)
          .json({ error: 'Error al actualizar el trigger del jackpot' });
      }
    }
  } else {
    res.status(404).json({ error: `Jackpot ${type} no encontrado` });
  }
});

const loadJackpotsFromDbToShow = async () => {
  try {
    const snapshot = await db
      .collection('jackpots')
      .where('active', '==', true)
      .get();
    const jackpots = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      jackpots.push({
        id: doc.id,
        nombre: data.nombre,
        amount: data.amount,
        allowedLevels: data.allowedLevels,
        maxAmount: data.maxAmount,
        active: data.active,
        contributions: data.contributions,
        idAutomatico: data.idAutomatico,
        idCasino: data.idCasino,
        idMaquina: data.idMaquina,
      });
    });
    console.log('Jackpots cargados correctamente desde Firestore', jackpots);
    return jackpots;
  } catch (error) {
    console.error('Error al cargar los jackpots desde Firestore:', error);
    throw error;
  }
};

const loadJackpotsFromDbToShowAllEver = async () => {
  try {
    const snapshot = await db.collection('jackpots').get();
    const jackpots = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      jackpots.push({
        id: doc.id,
        nombre: data.nombre,
        amount: data.amount,
        allowedLevels: data.allowedLevels,
        maxAmount: data.maxAmount,
        active: data.active,
        contributions: data.contributions,
        idAutomatico: data.idAutomatico,
        idCasino: data.idCasino,
        idMaquina: data.idMaquina,
      });
    });
    console.log('Jackpots cargados correctamente desde Firestore', jackpots);
    return jackpots;
  } catch (error) {
    console.error('Error al cargar los jackpots desde Firestore:', error);
    throw error;
  }
};

app.get('/api/alljackpotscreated', async (req, res) => {
  try {
    const jackpots = await loadJackpotsFromDbToShow();
    res.json(jackpots);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener los jackpots' });
  }
});

app.get('/api/alljackpotscreatedregisterever', async (req, res) => {
  try {
    const jackpotsAll = await loadJackpotsFromDbToShowAllEver();
    res.json(jackpotsAll);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener los jackpots' });
  }
});

app.get('/api/jackpot/:type', (req, res) => {
  const { type } = req.params;
  const jackpot = jackpots[type];
  if (jackpot) {
    res.json({ jackpotAmount: parseFloat(jackpot.amount).toFixed(2) });
  } else {
    res.status(404).json({ error: `Jackpot ${type} no encontrado` });
  }
});

app.get('/api/alljackpotscreatedforspin', async (req, res) => {
  try {
    const jackpotsSnapshot = await db.collection('jackpots').get();
    const jackpotsList = [];
    jackpotsSnapshot.forEach((doc) => {
      const jackpotData = doc.data();
      jackpotsList.push({
        idAutomatico: doc.id,
        ...jackpotData,
      });
    });
    res.json(jackpotsList);
  } catch (error) {
    console.error('Error al obtener los jackpots:', error);
    res.status(500).send('Error al obtener los jackpots');
  }
});

app.post('/api/updateJackpotLevels/:id', async (req, res) => {
  const { id } = req.params;
  const { allowedLevels } = req.body; 

  try {
    const jackpotRef = db.collection('jackpots').doc(id);
    const jackpotDoc = await jackpotRef.get();

    if (!jackpotDoc.exists) {
      return res.status(404).json({ error: `Jackpot con ID ${id} no encontrado` });
    }

    await jackpotRef.update({ allowedLevels });

    res.json({ message: `Niveles de ${id} actualizados correctamente`, allowedLevels });
  } catch (error) {
    if (error.code === 'RESOURCE_EXHAUSTED') {
      res.status(429).json({ error: 'Quota exceeded, please try again later' });
    } else {
      res.status(500).json({ error: 'Error al actualizar los niveles del jackpot' });
    }
  }
});



app.post('/api/spin/:type', async (req, res) => {
  initializeJackpots();
  const jackpotName = decodeURIComponent(req.params.type);
  const { amount, playerLevel } = req.body;

  console.log(`Tipo de jackpot recibido: ${jackpotName}`);
  console.log(`Cantidad recibida: ${amount}`);

  const docId = jackpotsMap.get(jackpotName);

  if (!docId) {
    console.error(`Jackpot ${jackpotName} no encontrado`);
    return res
      .status(404)
      .json({ error: `Jackpot ${jackpotName} no encontrado` });
  }

  try {
    const jackpotRef = db.collection('jackpots').doc(docId);
    const jackpotDoc = await jackpotRef.get();

    if (!jackpotDoc.exists) {
      console.error(`Jackpot ${jackpotName} no encontrado en Firestore`);
      return res
        .status(404)
        .json({ error: `Jackpot ${jackpotName} no encontrado en Firestore` });
    }

    const jackpot = jackpotDoc.data();


     if (!jackpot.allowedLevels.includes(playerLevel)) {
      return res.status(403).json({ error: 'Nivel de jugador no permitido para este jackpot' });
    }

    if (
      !jackpot.active &&
      parseFloat(jackpot.amount) + parseFloat(amount) >= jackpot.maxAmount
    ) {
      jackpot.active = true;
      try {
        await db.collection('jackpots').doc(docId).update(jackpot);
        res.json({
          amountWon: '0.00',
          jackpotAmount: parseFloat(jackpot.amount).toFixed(2),
          inJackpot: true,
          wonJackpot: false,
        });
      } catch (error) {
        if (error.code === 'RESOURCE_EXHAUSTED') {
          res
            .status(429)
            .json({ error: 'Quota exceeded, please try again later' });
        } else {
          res.status(500).json({ error: 'Error al actualizar el jackpot' });
        }
      }
      return;
    }

    if (jackpot.active) {
      let amountWon = '0.00';

      if (parseFloat(jackpot.amount) >= jackpot.maxAmount) {
        amountWon = parseFloat(jackpot.amount).toFixed(2);
        jackpot.amount = 0;
        jackpot.active = false;
        try {
          await db.collection('jackpots').doc(docId).update(jackpot);
          io.emit('jackpot-won', { type: jackpotName, amountWon });
        } catch (error) {
          if (error.code === 'RESOURCE_EXHAUSTED') {
            res
              .status(429)
              .json({ error: 'Quota exceeded, please try again later' });
          } else {
            res.status(500).json({ error: 'Error al actualizar el jackpot' });
          }
        }
      } else {
        const minPrize = 10;
        const maxPrize = 15.5;
        amountWon = (Math.random() * (maxPrize - minPrize) + minPrize).toFixed(
          1,
        );
        jackpot.amount = (
          parseFloat(jackpot.amount) + parseFloat(amountWon)
        ).toFixed(2);
        jackpot.contributions++;
        try {
          await db.collection('jackpots').doc(docId).update(jackpot);
        } catch (error) {
          if (error.code === 'RESOURCE_EXHAUSTED') {
            res
              .status(429)
              .json({ error: 'Quota exceeded, please try again later' });
          } else {
            res.status(500).json({ error: 'Error al actualizar el jackpot' });
          }
        }
      }

      res.json({
        amountWon,
        jackpotAmount: parseFloat(jackpot.amount).toFixed(2),
        inJackpot: jackpot.active,
        wonJackpot: amountWon === jackpot.maxAmount.toFixed(2),
      });
    } else {
      const minPrize = 10;
      const maxPrize = 15.5;
      let amountWon = (
        Math.random() * (maxPrize - minPrize) +
        minPrize
      ).toFixed(1);
      jackpot.amount = (
        parseFloat(jackpot.amount) + parseFloat(amountWon)
      ).toFixed(2);
      try {
        await db.collection('jackpots').doc(docId).update(jackpot);
      } catch (error) {
        if (error.code === 'RESOURCE_EXHAUSTED') {
          res
            .status(429)
            .json({ error: 'Quota exceeded, please try again later' });
        } else {
          res.status(500).json({ error: 'Error al actualizar el jackpot' });
        }
      }

      res.json({
        amountWon,
        jackpotAmount: parseFloat(jackpot.amount).toFixed(2),
        inJackpot: jackpot.active,
        wonJackpot: false,
      });
    }
  } catch (error) {
    console.error('Error al manejar el jackpot:', error);
    res.status(500).send('Error al manejar el jackpot');
  }
});

app.post('/api/deactivateJackpot/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const jackpotRef = db.collection('jackpots').doc(id);
    const jackpotDoc = await jackpotRef.get();

    if (!jackpotDoc.exists) {
      return res.status(404).json({ error: 'Jackpot no encontrado' });
    }

    await jackpotRef.update({ active: false });

    res.json({ message: 'Jackpot desactivado correctamente' });
  } catch (error) {
    if (error.code === 'RESOURCE_EXHAUSTED') {
      res.status(429).json({ error: 'Quota exceeded, please try again later' });
    } else {
      res.status(500).json({ error: 'Error al desactivar el jackpot' });
    }
  }
});

app.post('/api/activateJackpot/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const jackpotRef = db.collection('jackpots').doc(id);
    const jackpotDoc = await jackpotRef.get();

    if (!jackpotDoc.exists) {
      return res.status(404).json({ error: 'Jackpot no encontrado' });
    }

    await jackpotRef.update({ active: true });

    res.json({ message: 'Jackpot activado correctamente' });
  } catch (error) {
    if (error.code === 'RESOURCE_EXHAUSTED') {
      res.status(429).json({ error: 'Quota exceeded, please try again later' });
    } else {
      res.status(500).json({ error: 'Error al activar el jackpot' });
    }
  }
});

app.post('/api/resetJackpot/:type', async (req, res) => {
  const { type } = req.params;
  if (jackpots[type]) {
    jackpots[type].amount = 0;
    jackpots[type].active = false;
    jackpots[type].contributions = 0;
    try {
      await db.collection('jackpots').doc(type).update(jackpots[type]);
      res.json({ message: `${type} Jackpot reset successfully` });
    } catch (error) {
      if (error.code === 'RESOURCE_EXHAUSTED') {
        res
          .status(429)
          .json({ error: 'Quota exceeded, please try again later' });
      } else {
        res.status(500).json({ error: 'Error al resetear el jackpot' });
      }
    }
  } else {
    res.status(404).json({ error: `Jackpot ${type} no encontrado` });
  }
});




// Seccion Registros de transacciones

app.get('/api/transactions/:transactionId', (req, res) => {
  const { transactionId } = req.params;
  try {
    const transaction = transactions.find(
      (t) => t.transactionId === transactionId,
    );
    if (transaction) {
      res.json(transaction);
    } else {
      res.status(404).send('Transaction not found');
    }
  } catch (error) {
    console.error('Error fetching transaction:', error);
    res.status(500).send('Internal Server Error');
  }
});

app.post('/api/transactions', async (req, res) => {
  try {
    const transactionData = req.body;
    const transactionRef = db.collection('transactions').doc();
    const transactionId = transactionRef.id;
    await transactionRef.set({
      ...transactionData,
      transactionId: transactionId,
    });
    res
      .status(201)
      .json({ message: 'Transacción registrada exitosamente', transactionId });
  } catch (error) {
    console.error('Error al registrar la transacción:', error);
    res.status(500).json({ error: 'Error al procesar la solicitud' });
  }
});

app.get('/api/transactions', async (req, res) => {
  try {
    const transactionsSnapshot = await db.collection('transactions').get();
    const transactions = transactionsSnapshot.docs.map((doc) => doc.data());
    res.status(200).json(transactions);
  } catch (error) {
    console.error('Error al obtener las transacciones:', error);
    res.status(500).json({ error: 'Error al procesar la solicitud' });
  }
});


// ABM Casinos 

let casinos = {};
let casinosMap = new Map();

const initializeCasinos = async () => {
  try {
    const snapshot = await db.collection('casinos').get();
    snapshot.forEach((doc) => {
      const casinoData = doc.data();
      casinos[doc.id] = casinoData;
      casinosMap.set(doc.id, casinoData);
    });
    console.log('Casinos initialized:', casinos);
  } catch (error) {
    console.error('Error initializing casinos:', error);
  }
};

initializeCasinos();

app.post('/api/casinos', async (req, res) => {
  const { idCasino, ubicacion, pais, ciudad } = req.body;

  if (!idCasino || !ubicacion || !pais || !ciudad) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const newCasino = {
    idCasino,
    ubicacion,
    pais,
    ciudad,
    status: 'Active',
  };

  try {
    const docRef = await db.collection('casinos').doc(idCasino).set(newCasino);
    res.status(201).json({ id: docRef.id, ...newCasino });
  } catch (error) {
    console.error('Error creating casino:', error);
    res.status(500).json({ error: 'Error creating casino' });
  }
});

app.get('/api/casinos', async (req, res) => {
  try {
    const snapshot = await db.collection('casinos').get();
    const casinos = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    res.json(casinos);
  } catch (error) {
    console.error('Error fetching casinos:', error);
    res.status(500).json({ error: 'Error fetching casinos' });
  }
});

app.put('/api/casinos/:id', async (req, res) => {
  const { id } = req.params;
  const { idCasino, ubicacion, pais, ciudad } = req.body;

  if (!idCasino || !ubicacion || !pais || !ciudad) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const docRef = db.collection('casinos').doc(id);
    await docRef.update({ idCasino, ubicacion, pais, ciudad });
    res.json({ id, idCasino, ubicacion, pais, ciudad });
  } catch (error) {
    console.error('Error updating casino:', error);
    res.status(500).json({ error: 'Error updating casino' });
  }
});

app.post('/api/desactivateCasino/:idCasino', async (req, res) => {
  const { idCasino } = req.params;

  try {
    const docRef = db.collection('casinos').doc(idCasino);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }

    await docRef.update({ status: 'Inactive' });
    res.status(200).json({ message: 'User deactivated successfully' });
  } catch (error) {
    console.error('Error deactivating user:', error);
    res.status(500).json({ error: 'Error deactivating user' });
  }
});

app.post('/api/activateCasino/:idCasino', async (req, res) => {
  const { idCasino } = req.params;

  try {
    const snapshot = await db
      .collection('casinos')
      .where('idCasino', '==', idCasino)
      .get();

    if (snapshot.empty) {
      return res.status(404).json({ error: 'Casino not found' });
    }

    const batch = db.batch();
    snapshot.forEach((doc) => {
      batch.update(doc.ref, { status: 'Active' });
    });

    await batch.commit();
    res.status(200).json({ message: 'Casino activated successfully' });
  } catch (error) {
    console.error('Error activating casino:', error);
    res.status(500).json({ error: 'Error activating casino' });
  }
});



// ABM Grupos Casino

const initializeGruposCasino = async () => {
  try {
    const snapshot = await db.collection('grupos_casino').get();
    snapshot.forEach((doc) => {
      const grupoData = doc.data();
    });
    console.log('Grupos de casino initialized');
  } catch (error) {
    console.error('Error initializing grupos de casino:', error);
  }
};

initializeGruposCasino();

app.put('/api/modificarGruposCasino/:id', async (req, res) => {
  const { id } = req.params;
  const { idGrupoCasino, casinosAfiliados } = req.body;

  try {
    const docRef = db.collection('grupos_casino').doc(id);
    await docRef.update({ idGrupoCasino, casinosAfiliados });
    res.json({ id, idGrupoCasino, casinosAfiliados });
  } catch (error) {
    console.error('Error updating grupo de casino:', error);
    res.status(500).json({ error: 'Error updating grupo de casino' });
  }
});

app.post('/api/grupos_casino', async (req, res) => {
  const { idGrupoCasino, casinosAfiliados } = req.body;

  if (!idGrupoCasino || !casinosAfiliados) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const newGrupoCasino = {
    idGrupoCasino,
    casinosAfiliados,
    status: 'Active', 
  };

  try {
    await db.collection('grupos_casino').doc(idGrupoCasino).set(newGrupoCasino);
    res.status(201).json({ id: idGrupoCasino, ...newGrupoCasino });
  } catch (error) {
    console.error('Error creating grupo de casino:', error);
    res.status(500).json({ error: 'Error creating grupo de casino' });
  }
});

app.get('/api/grupos_casino', async (req, res) => {
  try {
    const snapshot = await db.collection('grupos_casino').get();
    const gruposCasino = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    res.json(gruposCasino);
  } catch (error) {
    console.error('Error fetching grupos de casino:', error);
    res.status(500).json({ error: 'Error fetching grupos de casino' });
  }
});

app.post('/api/desactivateGruposCasino/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const docRef = db.collection('grupos_casino').doc(id);
    await docRef.update({ status: 'Inactive' });
    res.json({ message: 'Grupo de casino deactivated successfully' });
  } catch (error) {
    console.error('Error deactivating grupo de casino:', error);
    res.status(500).json({ error: 'Error deactivating grupo de casino' });
  }
});

app.post('/api/activateGruposCasino/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const docRef = db.collection('grupos_casino').doc(id);
    await docRef.update({ status: 'Active' });
    res.json({ message: 'Grupo de casino activated successfully' });
  } catch (error) {
    console.error('Error activating grupo de casino:', error);
    res.status(500).json({ error: 'Error activating grupo de casino' });
  }
});


// ABM Grupos Maquinas


let gruposMaquinas = {};
let gruposMaquinasMap = new Map();

const initializeGruposMaquinas = async () => {
  try {
    const snapshot = await db.collection('grupos_maquinas').get();
    snapshot.forEach((doc) => {
      const grupoData = doc.data();
      gruposMaquinas[doc.id] = grupoData;
      gruposMaquinasMap.set(doc.id, grupoData);
    });
    console.log('Grupos de máquinas inicializados:', gruposMaquinas);
  } catch (error) {
    console.error('Error al inicializar los grupos de máquinas:', error);
  }
};

initializeGruposMaquinas();

app.post('/api/grupos_maquinas', async (req, res) => {
  const { idGrupoMaquina, maquinasAfiliadas } = req.body;

  if (!idGrupoMaquina || !maquinasAfiliadas) {
    return res.status(400).json({ error: 'Faltan campos requeridos' });
  }

  const newGrupoMaquina = {
    idGrupoMaquina,
    maquinasAfiliadas,
    status: true,
  };

  try {
    const docRef = db.collection('grupos_maquinas').doc(idGrupoMaquina);
    await docRef.set(newGrupoMaquina);
    res.status(201).json({ id: docRef.id, ...newGrupoMaquina });
  } catch (error) {
    console.error('Error al crear grupo de máquinas:', error);
    res.status(500).json({ error: 'Error al crear grupo de máquinas' });
  }
});

app.get('/api/grupos_maquinas', async (req, res) => {
  try {
    const snapshot = await db.collection('grupos_maquinas').get();
    const gruposMaquinas = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    res.json(gruposMaquinas);
  } catch (error) {
    console.error('Error al obtener grupos de máquinas:', error);
    res.status(500).json({ error: 'Error al obtener grupos de máquinas' });
  }
});

app.put('/api/grupos_maquinas/:id', async (req, res) => {
  const { id } = req.params;
  const { idGrupoMaquina, maquinasAfiliadas } = req.body;

  if (!idGrupoMaquina || !maquinasAfiliadas) {
    return res.status(400).json({ error: 'Faltan campos requeridos' });
  }

  try {
    const docRef = db.collection('grupos_maquinas').doc(id);
    await docRef.update({ idGrupoMaquina, maquinasAfiliadas });
    res.json({ id, idGrupoMaquina, maquinasAfiliadas });
  } catch (error) {
    console.error('Error al actualizar grupo de máquinas:', error);
    res.status(500).json({ error: 'Error al actualizar grupo de máquinas' });
  }
});

app.post('/api/desactivate_grupos_maquinas/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const docRef = db.collection('grupos_maquinas').doc(id);
    await docRef.update({ status: false });
    res.json({ message: 'Grupo de máquinas desactivado exitosamente' });
  } catch (error) {
    console.error('Error al desactivar grupo de máquinas:', error);
    res.status(500).json({ error: 'Error al desactivar grupo de máquinas' });
  }
});


// ABM Maquinas

let maquinas = {};
let maquinasMap = new Map();

const initializeMaquinas = async () => {
  try {
    const snapshot = await db.collection('maquinas').get();
    snapshot.forEach((doc) => {
      const maquinaData = doc.data();
      maquinas[doc.id] = maquinaData;
      maquinasMap.set(maquinaData.idGMFriendly, doc.id);
    });
    console.log('Máquinas inicializadas:', maquinas);
  } catch (error) {
    console.error('Error al inicializar las máquinas:', error);
  }
};

initializeMaquinas();

app.post('/api/maquinas', async (req, res) => {
  const {
    idGM,
    idGMFriendly,
    idCasino,
    idArea,
    fecha,
    idGMMAnufacturer,
    baseAccounting,
    gmSerialNumber,
  } = req.body;

  if (
    !idGM ||
    !idGMFriendly ||
    !idCasino ||
    !idArea ||
    !fecha ||
    !idGMMAnufacturer ||
    !baseAccounting ||
    !gmSerialNumber
  ) {
    return res.status(400).json({ error: 'Faltan datos obligatorios' });
  }

  const newMaquina = {
    idGM,
    idGMFriendly,
    idCasino,
    idArea,
    fecha,
    idGMMAnufacturer,
    baseAccounting,
    gmSerialNumber,
    active: true,
  };

  try {
    await db.collection('maquinas').doc(idGM).set(newMaquina); // Usar set() con el idGM como ID del documento
    res.status(201).json({ id: idGM, ...newMaquina });
  } catch (error) {
    console.error('Error al crear la máquina:', error);
    res.status(500).json({ error: 'Error al crear la máquina' });
  }
});

app.get('/api/maquinas', async (req, res) => {
  try {
    const snapshot = await db.collection('maquinas').get();
    const maquinas = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    res.json(maquinas);
  } catch (error) {
    console.error('Error al obtener las máquinas:', error);
    res.status(500).json({ error: 'Error al obtener las máquinas' });
  }
});

app.put('/api/maquinas/:idGM', async (req, res) => {
  const { idGM } = req.params;
  const {
    idGMFriendly,
    idCasino,
    idArea,
    fecha,
    idGMMAnufacturer,
    baseAccounting,
    gmSerialNumber,
  } = req.body;

  if (
    !idGMFriendly ||
    !idCasino ||
    !idArea ||
    !fecha ||
    !idGMMAnufacturer ||
    !baseAccounting ||
    !gmSerialNumber
  ) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const docRef = db.collection('maquinas').doc(idGM);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Machine not found' });
    }

    await docRef.update({
      idGMFriendly,
      idCasino,
      idArea,
      fecha,
      idGMMAnufacturer,
      baseAccounting,
      gmSerialNumber,
    });

    res.json({
      idGM,
      idGMFriendly,
      idCasino,
      idArea,
      fecha,
      idGMMAnufacturer,
      baseAccounting,
      gmSerialNumber,
    });
  } catch (error) {
    console.error('Error updating machine:', error);
    res.status(500).json({ error: 'Error updating machine' });
  }
});

app.post('/api/activateMaquina/:idGM', async (req, res) => {
  const { idGM } = req.params;

  try {
    const snapshot = await db
      .collection('maquinas')
      .where('idGM', '==', idGM)
      .get();

    if (snapshot.empty) {
      return res.status(404).json({ error: 'Máquina no encontrada' });
    }

    const batch = db.batch();
    snapshot.forEach((doc) => {
      batch.update(doc.ref, { active: true });
    });

    await batch.commit();
    res.status(200).json({ message: 'Máquina activada correctamente' });
  } catch (error) {
    console.error('Error al activar la máquina:', error);
    res.status(500).json({ error: 'Error al activar la máquina' });
  }
});

app.post('/api/deactivateMaquina/:idGM', async (req, res) => {
  const { idGM } = req.params;

  try {
    const snapshot = await db
      .collection('maquinas')
      .where('idGM', '==', idGM)
      .get();

    if (snapshot.empty) {
      return res.status(404).json({ error: 'Máquina no encontrada' });
    }

    const batch = db.batch();
    snapshot.forEach((doc) => {
      batch.update(doc.ref, { active: false });
    });

    await batch.commit();
    res.status(200).json({ message: 'Máquina desactivada correctamente' });
  } catch (error) {
    console.error('Error al desactivar la máquina:', error);
    res.status(500).json({ error: 'Error al desactivar la máquina' });
  }
});


// ABM Usuarios

let users = {};
let usersMap = new Map();

const initializeUsers = async () => {
  try {
    const snapshot = await db.collection('usuarios').get();
    snapshot.forEach((doc) => {
      const userData = doc.data();
      users[doc.id] = userData;
      usersMap.set(doc.id, userData);
    });
    console.log('Users initialized:', users);
  } catch (error) {
    console.error('Error initializing users:', error);
  }
};

initializeUsers();

const authenticate = async (req, res, next) => {
  const idToken = req.headers.authorization?.split('Bearer ')[1];

  if (!idToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const decodedToken = await firebaseAdmin.auth().verifyIdToken(idToken);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('Error verifying token:', error);
    res.status(401).json({ error: 'Unauthorized' });
  }
};

app.post('/api/users', async (req, res) => {
  const { idUser, name, role, permissions } = req.body;

  if (!idUser || !name || !role || !permissions) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const newUser = {
    idUser,
    name,
    role,
    permissions,
    status: 'Active',
  };

  try {
    const docRef = db.collection('usuarios').doc(idUser);
    await docRef.set(newUser);
    res.status(201).json({ idUser, ...newUser });
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ error: 'Error creating user' });
  }
});

app.get('/api/user', authenticate, async (req, res) => {
  try {
    const doc = await db.collection('usuarios').doc(req.user.uid).get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(doc.data());
  } catch (error) {
    console.error('Error fetching user data:', error);
    res.status(500).json({ error: 'Error fetching user data' });
  }
});

app.get('/api/users', async (req, res) => {
  try {
    const snapshot = await db.collection('usuarios').get();
    const users = snapshot.docs.map((doc) => ({
      idUser: doc.id,
      ...doc.data(),
    }));
    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Error fetching users' });
  }
});

app.put('/api/users/:idUser', async (req, res) => {
  const { idUser } = req.params;
  const { name, role, permissions } = req.body;

  if (!name || !role || !permissions) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const docRef = db.collection('usuarios').doc(idUser);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }

    await docRef.update({
      name,
      role,
      permissions,
    });

    res.json({ idUser, name, role, permissions });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Error updating user' });
  }
});

app.post('/api/desactivateUsuario/:idUser', async (req, res) => {
  const { idUser } = req.params;

  try {
    const docRef = db.collection('usuarios').doc(idUser);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }

    await docRef.update({ status: 'Inactive' });
    res.status(200).json({ message: 'User deactivated successfully' });
  } catch (error) {
    console.error('Error deactivating user:', error);
    res.status(500).json({ error: 'Error deactivating user' });
  }
});

app.post('/api/activateUsuario/:idUser', async (req, res) => {
  const { idUser } = req.params;

  try {
    const docRef = db.collection('usuarios').doc(idUser);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }

    await docRef.update({ status: 'Active' });
    res.status(200).json({ message: 'User activated successfully' });
  } catch (error) {
    console.error('Error activating user:', error);
    res.status(500).json({ error: 'Error activating user' });
  }
});


// Reportes y Notificaciones

app.post('/reports', async (req, res) => {
  const { userName, report, date } = req.body;

  if (!userName || !report || !date) {
    return res.status(400).send('Faltan datos');
  }

  const newReport = {
    userName,
    report,
    date,
    timestamp: admin.firestore.Timestamp.now(),
  };

  try {
    await reportsCollection.add(newReport);
    console.log(`Reporte recibido: ${userName} - ${report}`);
    res.status(200).send('Reporte recibido');
  } catch (error) {
    console.error('Error al guardar el reporte en Firestore:', error);
    res.status(500).send('Error al guardar el reporte');
  }
});

app.get('/reports', async (req, res) => {
  try {
    const snapshot = await reportsCollection.get();
    const reports = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    res.json(reports);
  } catch (error) {
    console.error('Error al obtener los reportes de Firestore:', error);
    res.status(500).send('Error al obtener los reportes');
  }
});

app.post('/api/notifications', async (req, res) => {
  const { text, date, img } = req.body;
  console.log('Datos recibidos:', { text, date, img });

  const newNotification = {
    text,
    date,
    img,
  };

  try {
    const docRef = await db.collection('notifications').add(newNotification);
    res.status(201).json({ id: docRef.id, ...newNotification });
  } catch (error) {
    console.error('Error al agregar la notificación:', error);
    res.status(500).json({ error: 'Error al agregar la notificación' });
  }
});

app.get('/api/notifications', async (req, res) => {
  try {
    const snapshot = await db.collection('notifications').get();
    const notifications = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    res.json(notifications);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener las notificaciones' });
  }
});

app.delete('/api/notifications/:id', async (req, res) => {
  const { id } = req.params;

  try {
    await db.collection('notifications').doc(id).delete();
    res.json({ message: 'Notificación eliminada correctamente' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar la notificación' });
  }
});



// Abm Players


let players = {};
let playersMap = new Map();

const initializePlayers = async () => {
  try {
    const snapshot = await db.collection('players').get();
    snapshot.forEach((doc) => {
      const playerData = doc.data();
      players[doc.id] = playerData;
      playersMap.set(doc.id, playerData);
    });
    console.log('Players initialized:', players);
  } catch (error) {
    console.error('Error initializing players:', error);
  }
};

initializePlayers();

app.post('/api/players', async (req, res) => {
  const { idPlayer, username, nivel } = req.body;

  if (!idPlayer || !username || !nivel) {
    return res.status(400).json({ error: 'Faltan campos requeridos' });
  }

  const newPlayer = {
    idPlayer,
    username,
    nivel,
    status: 'Active', 
  };

  try {
    const docRef = await db.collection('players').doc(idPlayer).set(newPlayer);
    res.status(201).json({ id: docRef.id, ...newPlayer });
  } catch (error) {
    console.error('Error al crear el jugador:', error);
    res.status(500).json({ error: 'Error al crear el jugador' });
  }
});

app.get('/api/players', async (req, res) => {
  try {
    const snapshot = await db.collection('players').get();
    const playersList = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    res.json(playersList);
  } catch (error) {
    console.error('Error al obtener los jugadores:', error);
    res.status(500).json({ error: 'Error al obtener los jugadores' });
  }
});

app.put('/api/players/:idPlayer', async (req, res) => {
  const { idPlayer } = req.params;
  const updateData = req.body;

  try {
    const docRef = db.collection('players').doc(idPlayer);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Jugador no encontrado' });
    }

    await docRef.update(updateData);

    res.json({ idPlayer, ...updateData });
  } catch (error) {
    console.error('Error al actualizar el jugador:', error);
    res.status(500).json({ error: 'Error al actualizar el jugador' });
  }
});


app.post('/api/activatePlayer/:idPlayer', async (req, res) => {
  const { idPlayer } = req.params;

  try {
    const docRef = db.collection('players').doc(idPlayer);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Jugador no encontrado' });
    }

    await docRef.update({ status: 'Active' });
    res.json({ message: 'Jugador activado correctamente' });
  } catch (error) {
    console.error('Error al activar el jugador:', error);
    res.status(500).json({ error: 'Error al activar el jugador' });
  }
});



app.post('/api/desactivatePlayer/:idPlayer', async (req, res) => {
  const { idPlayer } = req.params;

  try {
    const docRef = db.collection('players').doc(idPlayer);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Jugador no encontrado' });
    }

    await docRef.update({ status: 'Inactive' });
    res.json({ message: 'Jugador desactivado correctamente' });
  } catch (error) {
    console.error('Error al desactivar el jugador:', error);
    res.status(500).json({ error: 'Error al desactivar el jugador' });
  }
});



app.delete('/api/players/:idPlayer', async (req, res) => {
  const { idPlayer } = req.params;

  try {
    const docRef = db.collection('players').doc(idPlayer);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Jugador no encontrado' });
    }

    await docRef.delete();
    res.json({ message: 'Jugador eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar el jugador:', error);
    res.status(500).json({ error: 'Error al eliminar el jugador' });
  }
});



app.put('/api/players/:idPlayer/balance', async (req, res) => {
  const { idPlayer } = req.params;
  let { balance } = req.body;

  try {
    balance = parseFloat(balance);

    if (isNaN(balance)) {
      return res.status(400).json({ message: 'Balance debe ser un número válido' });
    }

    const playerRef = db.collection('players').doc(idPlayer);

    const playerDoc = await playerRef.get();
    if (!playerDoc.exists) {
      return res.status(404).json({ message: 'Jugador no encontrado' });
    }

    await playerRef.update({ balance });

    res.json({ message: 'Balance actualizado', balance });
  } catch (error) {
    console.error('Error al actualizar balance:', error);
    res.status(500).json({ message: 'Error interno del servidor', error: error.message });
  }
});



app.get('/api/players/:idPlayer/balance', async (req, res) => {
  const { idPlayer } = req.params;

  try {
    const playerRef = db.collection('players').doc(idPlayer);
    
    const playerDoc = await playerRef.get();

    if (!playerDoc.exists) {
      return res.status(404).json({ message: 'Jugador no encontrado' });
    }

    const playerData = playerDoc.data();

    res.json({ balance: playerData.balance || 0 });
  } catch (error) {
    console.error('Error al obtener balance:', error);
    res.status(500).json({ message: 'Error interno del servidor', error: error.message });
  }
});



httpServer.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
});
