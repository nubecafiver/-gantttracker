// ═══════════════════════════════════════════════
// GanttTracker Pro — Alertas automáticas
// Corre cada día a las 8am hora México
// Revisa tareas sin actualizar hace más de 3 días
// ═══════════════════════════════════════════════

const fetch = require('node-fetch');

const FIREBASE_API_KEY  = process.env.FIREBASE_API_KEY;
const FIREBASE_PROJECT  = process.env.FIREBASE_PROJECT_ID;
const EMAILJS_SERVICE   = process.env.EMAILJS_SERVICE_ID;
const EMAILJS_TEMPLATE  = process.env.EMAILJS_TEMPLATE_ID;
const EMAILJS_PUBKEY    = process.env.EMAILJS_PUBLIC_KEY;
const ADMIN_EMAIL       = process.env.ADMIN_EMAIL;
const DIAS_LIMITE       = parseInt(process.env.DIAS_LIMITE || '3');

const FIRESTORE_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents`;

// Directorio de usuarios (correo → nombre)
const USER_DIR = {
  'aosorio@cafiver.com.mx':        'Alan Osorio Cruz',
  'vlopez@cafiver.com.mx':         'Valery Lopez Olmedo',
  'soportetec@cafiver.com.mx':     'Daniela Gomez Aleluya',
  'soportetecnico@cafiver.com.mx': 'Rafael Aguila',
  'ramaya@cafiver.com.mx':         'Roberto Amaya',
  'usuario1@cafiver.com.mx':       'Usuario1',
  'usuario2@cafiver.com.mx':       'Usuario2'
};

// Responsable → correos asignados por defecto
const RESP_EMAILS = {
  'U': ['aosorio@cafiver.com.mx', 'vlopez@cafiver.com.mx', 'ramaya@cafiver.com.mx'],
  'T': ['soportetecnico@cafiver.com.mx', 'soportetec@cafiver.com.mx'],
  'P': [], // Proveedor externo - solo va al admin
  'S': ['aosorio@cafiver.com.mx', 'soportetecnico@cafiver.com.mx']
};

function diasSinActualizar(updTs) {
  if (!updTs) return 999; // Nunca actualizada
  // updTs formato: "dd/mm/yy, hh:mm" (es-MX locale)
  try {
    // Intentar parsear fecha mexicana
    const partes = updTs.split(', ')[0].split('/');
    if (partes.length === 3) {
      const dia = parseInt(partes[0]);
      const mes = parseInt(partes[1]) - 1;
      const anio = parseInt(partes[2]) + (parseInt(partes[2]) < 100 ? 2000 : 0);
      const fecha = new Date(anio, mes, dia);
      const hoy = new Date();
      hoy.setHours(0,0,0,0);
      fecha.setHours(0,0,0,0);
      return Math.floor((hoy - fecha) / 86400000);
    }
  } catch(e) {}
  return 999;
}

async function getTasks() {
  const url = `${FIRESTORE_URL}/tasks?key=${FIREBASE_API_KEY}&pageSize=300`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.documents) return [];
  return data.documents.map(doc => {
    const f = doc.fields || {};
    const get = (k) => f[k] ? (f[k].stringValue || f[k].integerValue || f[k].booleanValue || '') : '';
    return {
      id:     doc.name.split('/').pop(),
      name:   get('name'),
      proj:   get('proj'),
      resp:   get('resp'),
      status: get('status'),
      pct:    get('pct'),
      assign: get('assign'),
      updTs:  get('updTs'),
      updBy:  get('updBy'),
      start:  get('start'),
      end:    get('end')
    };
  });
}

async function sendEmail(toEmail, toName, taskName, projName, dias, assignado, resp) {
  const respLabel = {U:'Usuario',T:'TI',P:'Proveedor',S:'Compartido'}[resp] || resp;
  const mensaje = 
    `Hola ${toName},\n\n` +
    `⚠️ La siguiente tarea lleva ${dias} día(s) sin actualización:\n\n` +
    `📋 Tarea: ${taskName}\n` +
    `📁 Proyecto: ${projName}\n` +
    `👤 Asignado a: ${assignado || 'Sin asignar'}\n` +
    `🏷️ Responsable: ${respLabel}\n\n` +
    `Por favor entra a GanttTracker Pro y actualiza el avance:\n` +
    `https://nubecafiver.github.io/gantttracker/\n\n` +
    `Saludos,\nGanttTracker Pro — APP CAFIVER`;

  const payload = {
    service_id:  EMAILJS_SERVICE,
    template_id: EMAILJS_TEMPLATE,
    user_id:     EMAILJS_PUBKEY,
    template_params: {
      to_email:  toEmail,
      to_name:   toName,
      from_name: 'GanttTracker Pro',
      subject:   `⚠️ Tarea sin actualizar (${dias} días): ${taskName}`,
      message:   mensaje
    }
  };

  const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  return res.status === 200;
}

async function main() {
  console.log(`\n🚀 GanttTracker Pro — Revisión diaria de tareas`);
  console.log(`📅 Fecha: ${new Date().toLocaleDateString('es-MX')}`);
  console.log(`⏰ Límite: ${DIAS_LIMITE} días sin actualizar\n`);

  const tasks = await getTasks();
  console.log(`📋 Total tareas encontradas: ${tasks.length}`);

  // Filtrar tareas pendientes o en progreso sin actualizar
  const alertas = tasks.filter(t => {
    if (t.status === 'completado' || t.status === 'cancelado') return false;
    const dias = diasSinActualizar(t.updTs);
    return dias >= DIAS_LIMITE;
  });

  console.log(`⚠️  Tareas que requieren alerta: ${alertas.length}\n`);

  if (alertas.length === 0) {
    console.log('✅ Todo al día. Sin alertas que enviar.');
    return;
  }

  // Agrupar alertas por correo destinatario
  const emailMap = {}; // email -> [{task, dias}]

  for (const t of alertas) {
    const dias = diasSinActualizar(t.updTs);
    const destinatarios = new Set();

    // Responsables por tipo
    const respEmails = RESP_EMAILS[t.resp] || [];
    respEmails.forEach(e => destinatarios.add(e));

    // Asignado específico
    if (t.assign) {
      const asignado = t.assign.toLowerCase().trim();
      Object.keys(USER_DIR).forEach(email => {
        if (USER_DIR[email].toLowerCase().includes(asignado) || email.includes(asignado)) {
          destinatarios.add(email);
        }
      });
    }

    // Siempre incluir al admin
    if (ADMIN_EMAIL) destinatarios.add(ADMIN_EMAIL);

    destinatarios.forEach(email => {
      if (!emailMap[email]) emailMap[email] = [];
      emailMap[email].push({ task: t, dias });
    });
  }

  // Enviar un correo por destinatario con todas sus tareas pendientes
  let enviados = 0;
  for (const [email, items] of Object.entries(emailMap)) {
    const nombre = USER_DIR[email] || email.split('@')[0];
    
    // Si tiene múltiples tareas, mandar una por una
    for (const { task, dias } of items) {
      console.log(`📧 Enviando a ${nombre} (${email}): "${task.name}" — ${dias} días sin actualizar`);
      try {
        const ok = await sendEmail(email, nombre, task.name, task.proj, dias, task.assign, task.resp);
        if (ok) {
          enviados++;
          console.log(`   ✅ Enviado`);
        } else {
          console.log(`   ❌ Error al enviar`);
        }
        // Esperar 1 segundo entre correos para no saturar EmailJS
        await new Promise(r => setTimeout(r, 1000));
      } catch(e) {
        console.log(`   ❌ Error: ${e.message}`);
      }
    }
  }

  console.log(`\n✅ Proceso completado. Correos enviados: ${enviados}`);
}

main().catch(e => {
  console.error('Error fatal:', e);
  process.exit(1);
});
