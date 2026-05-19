import { addDays, format, isBefore, parseISO } from 'date-fns'

export const STATUS = [
  ['a_criar', 'A Criar'],
  ['em_producao', 'Em Produção'],
  ['aguardando_aprovacao', 'Aguardando Aprovação'],
  ['aprovado', 'Aprovado'],
  ['publicado', 'Publicado'],
  ['erro_publicacao', 'Erro na Publicação'],
]

export const TYPES = [
  ['feed_foto', 'Feed foto'],
  ['feed_carrossel', 'Feed carrossel'],
  ['reels', 'Reels'],
  ['stories', 'Stories'],
]

export const WEEKDAYS = [
  ['segunda', 1],
  ['terca', 2],
  ['quarta', 3],
  ['quinta', 4],
  ['sexta', 5],
  ['sabado', 6],
  ['domingo', 0],
]

export const demoClients = [
  {
    id: 'demo-1',
    nome: 'Letícia Studio',
    instagram_url: 'https://instagram.com/leticiastudio',
    instagram_user_id: '17841400000000000',
    foto_perfil_url: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=200&q=80',
  },
]

export const demoContents = [
  {
    id: 'c1', cliente_id: 'demo-1', titulo: 'Antes e depois', referencia_url: 'https://instagram.com', status: 'a_criar', tipo: 'feed_foto', midia_urls: [], legenda: '', data_agendada: addDays(new Date(), 2).toISOString(), notas: '',
  },
  {
    id: 'c2', cliente_id: 'demo-1', titulo: 'Bastidores da equipe', referencia_url: '', status: 'em_producao', tipo: 'reels', midia_urls: [], legenda: '', data_agendada: addDays(new Date(), 1).toISOString(), notas: '',
  },
  {
    id: 'c3', cliente_id: 'demo-1', titulo: 'Calendário editorial', referencia_url: '', status: 'aguardando_aprovacao', tipo: 'feed_carrossel', midia_urls: ['https://images.unsplash.com/photo-1557683316-973673baf926?auto=format&fit=crop&w=900&q=80','https://images.unsplash.com/photo-1557682250-33bd709cbe85?auto=format&fit=crop&w=900&q=80'], legenda: 'Planejamento claro, publicação leve.', data_agendada: addDays(new Date(), 3).toISOString(), notas: '',
  },
]

export const demoNotes = [
  { id: 'n1', cliente_id: 'demo-1', texto: 'Tom de voz: direto, elegante e sem excesso de emojis.', criado_em: new Date().toISOString() },
]

export function buildSlots(frequency, clientId) {
  const today = new Date()
  const rows = []
  Object.entries(frequency).forEach(([group, config]) => {
    if (config.ativo === false) return
    const type = group === 'feed' ? 'feed_foto' : group
    for (let i = 0; i < 30; i += 1) {
      const day = addDays(today, i)
      const weekday = WEEKDAYS.find(([, value]) => value === day.getDay())?.[0]
      if (!config.dias?.includes(weekday)) continue
      const [hours, minutes] = (config.horario || '09:00').split(':').map(Number)
      const scheduled = new Date(day)
      scheduled.setHours(hours, minutes, 0, 0)
      rows.push({
        id: crypto.randomUUID(),
        cliente_id: clientId,
        titulo: '', referencia_url: '', status: 'a_criar', tipo: type,
        midia_urls: [], legenda: '', data_agendada: scheduled.toISOString(), notas: '',
      })
    }
  })
  return rows
}

export function nextSlot(contents) {
  const future = contents
    .filter((item) => item.status === 'a_criar' && item.titulo?.trim() && item.data_agendada && !isBefore(parseISO(item.data_agendada), new Date()))
    .sort((a, b) => new Date(a.data_agendada) - new Date(b.data_agendada))[0]
  return future?.data_agendada || addDays(new Date(), 1).toISOString()
}

export function prettyDate(value) {
  return value ? format(parseISO(value), "dd/MM/yyyy 'às' HH:mm") : 'Sem data'
}

