import { useEffect, useMemo, useState } from 'react'
import { AtSign, CalendarClock, CheckCircle2, CirclePlus, Clock, ExternalLink, Image, NotebookPen, Send, Sparkles, Video, X, Zap } from 'lucide-react'
import { hasSupabase, supabase, uploadPublicFile } from './lib.supabase'
import { demoClients, demoContents, demoNotes, nextSlot, prettyDate, STATUS, TYPES, WEEKDAYS } from './data'
import './index.css'

const emptyFrequency = {
  feed: { ativo: true, quantidade: 2, dias: ['terca', 'quinta'], horario: '10:00' },
  reels: { ativo: true, quantidade: 2, dias: ['segunda', 'quarta'], horario: '18:00' },
  stories: { ativo: true, quantidade: 1, dias: ['sexta'], horario: '09:00' },
}

const channelMeta = {
  feed: { label: 'Feed', hint: 'Fotos e carrosséis', icon: Image },
  reels: { label: 'Reels', hint: 'Vídeos curtos', icon: Video },
  stories: { label: 'Stories', hint: 'Conteúdo rápido', icon: Zap },
}

function toDateTimeLocalValue(value) {
  if (!value) return ''
  const date = new Date(value)
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return localDate.toISOString().slice(0, 16)
}

function localDateTimeToIso(value) {
  return new Date(value).toISOString()
}

function App() {
  const [clients, setClients] = useState(hasSupabase ? [] : demoClients)
  const [contents, setContents] = useState(hasSupabase ? [] : demoContents)
  const [notes, setNotes] = useState(hasSupabase ? [] : demoNotes)
  const [session, setSession] = useState(null)
  const [authLoading, setAuthLoading] = useState(hasSupabase)
  const [selectedClientId, setSelectedClientId] = useState(null)
  const [modal, setModal] = useState(null)
  const [loading, setLoading] = useState(hasSupabase)
  const [toast, setToast] = useState(hasSupabase ? 'Conectando ao Supabase...' : 'Modo demo ativo: conecte o Supabase para persistir dados reais.')

  const selectedClient = clients.find((client) => client.id === selectedClientId)
  const clientContents = contents.filter((item) => item.cliente_id === selectedClientId)
  const clientNotes = notes.filter((item) => item.cliente_id === selectedClientId)

  const counts = useMemo(() => Object.fromEntries(clients.map((client) => [
    client.id,
    Object.fromEntries(STATUS.map(([key]) => [key, contents.filter((item) => item.cliente_id === client.id && item.status === key).length])),
  ])), [clients, contents])

  useEffect(() => {
    if (!supabase) {
      return
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setAuthLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setAuthLoading(false)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!supabase || !session) return

    async function loadData() {
      setLoading(true)
      const [clientsRes, contentsRes, notesRes] = await Promise.all([
        supabase.from('clientes').select('*').order('criado_em', { ascending: false }),
        supabase.from('conteudos').select('*').order('data_agendada', { ascending: true }),
        supabase.from('notas_cliente').select('*').order('criado_em', { ascending: false }),
      ])

      const firstError = clientsRes.error || contentsRes.error || notesRes.error
      if (firstError) {
        setToast('Supabase conectado, mas as tabelas ainda n?o existem. Execute o schema.sql no painel para ativar a persist?ncia.')
        setLoading(false)
        return
      }

      setClients(clientsRes.data)
      setContents(contentsRes.data)
      setNotes(notesRes.data)
      setToast('Supabase conectado.')
      setLoading(false)
    }

    loadData()
  }, [session])

  if (authLoading) {
    return <main className="grid min-h-screen place-items-center px-4 text-zinc-100"><div className="glass rounded-[2rem] px-6 py-5 text-sm text-zinc-200">Abrindo o CRM...</div></main>
  }

  if (hasSupabase && !session) {
    return <AuthScreen />
  }

  async function persistClient(payload) {
    if (!supabase) return { ...payload, id: crypto.randomUUID() }
    const { data, error } = await supabase.from('clientes').insert(payload).select().single()
    if (error) throw error
    return data
  }

  async function addClient(payload) {
    try {
      let profileUrl = payload.foto_perfil_url
      if (payload.foto_perfil_file) {
        try {
          profileUrl = await uploadPublicFile(payload.foto_perfil_file, 'profiles')
        } catch (error) {
          console.error('Falha ao enviar foto de perfil:', error)
          setToast(`Não consegui enviar a foto, mas vou salvar o cliente sem ela. Detalhe: ${error.message}`)
        }
      }
      const client = await persistClient({
        nome: payload.nome.trim(),
        instagram_url: payload.instagram_url.trim(),
        instagram_user_id: payload.instagram_user_id.trim(),
        foto_perfil_url: profileUrl,
      })
      if (supabase) {
        if (payload.access_token?.trim()) {
          const { error: tokenError } = await supabase
            .from('cliente_segredos')
            .insert({
              cliente_id: client.id,
              access_token: payload.access_token.trim(),
            })
          if (tokenError) throw tokenError
        }
        const { error: scheduleError } = await supabase.from('agendamentos').insert({
          cliente_id: client.id,
          tipo: 'mix',
          frequencia: Object.fromEntries(Object.entries(payload.frequencia).filter(([, cfg]) => cfg.ativo)),
        })
        if (scheduleError) {
          console.error('Cliente salvo, mas falhou ao salvar agendamento:', scheduleError)
          setToast(`Cliente salvo, mas o agendamento não entrou: ${scheduleError.message}`)
        }
      }
      setClients((current) => [client, ...current])
      setToast(`${client.nome} entrou no board e foi salvo na tabela.`)
      setModal(null)
    } catch (error) {
      console.error('Falha ao salvar cliente:', error)
      setToast(`Não consegui salvar o cliente: ${error.message}`)
    }
  }

  async function updateContent(id, patch) {
    if (supabase) {
      const { error } = await supabase.from('conteudos').update(patch).eq('id', id)
      if (error) {
        setToast(`N?o consegui salvar a altera??o: ${error.message}`)
        return
      }
    }
    setContents((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item))
  }

  async function addContent(payload) {
    const draft = {
      cliente_id: selectedClientId, titulo: payload.titulo, referencia_url: payload.referencia_url,
      status: 'a_criar', tipo: payload.tipo, midia_urls: [], legenda: '', data_agendada: payload.data_agendada, notas: payload.notas,
    }
    const saved = supabase
      ? await supabase.from('conteudos').insert(draft).select().single()
      : { data: { ...draft, id: crypto.randomUUID() }, error: null }
    if (saved.error) {
      setToast(`N?o consegui salvar o conte?do: ${saved.error.message}`)
      return
    }
    setContents((current) => [...current, saved.data])
    setModal(null)
  }

  async function addNote(texto) {
    const draft = { cliente_id: selectedClientId, texto }
    const saved = supabase
      ? await supabase.from('notas_cliente').insert(draft).select().single()
      : { data: { ...draft, id: crypto.randomUUID(), criado_em: new Date().toISOString() }, error: null }
    if (saved.error) {
      setToast(`N?o consegui salvar a nota: ${saved.error.message}`)
      return
    }
    setNotes((current) => [saved.data, ...current])
  }

  return (
    <main className="min-h-screen px-4 py-5 text-zinc-100 md:px-8 md:py-8">
      <header className="mx-auto mb-8 flex max-w-7xl flex-col justify-between gap-5 md:mb-10 md:flex-row md:items-end">
        <div>
          <p className="mb-2 text-xs uppercase tracking-[0.36em] text-zinc-400">CRM Social Media</p>
          <h1 className="max-w-3xl text-3xl font-semibold tracking-[-0.04em] text-white md:text-5xl">Gestão de conteúdo com clareza, ritmo e presença.</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {session?.user?.email && <span className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-300">{session.user.email}</span>}
          {supabase && <button onClick={() => supabase.auth.signOut()} className="rounded-full border border-white/10 px-4 py-2 text-sm text-zinc-300 transition hover:bg-white/10 hover:text-white">Sair</button>}
          <button onClick={() => setModal({ type: 'client' })} className="shine soft-ring rounded-full px-5 py-3 font-medium text-white transition hover:-translate-y-0.5 hover:bg-white/10">+ Novo Cliente</button>
        </div>
      </header>

      {toast && <div className="glass mx-auto mb-6 max-w-7xl rounded-3xl px-4 py-3 text-sm text-zinc-200">{toast}</div>}

      {loading && <div className="glass mx-auto mb-6 max-w-7xl rounded-3xl px-4 py-3 text-sm text-zinc-200">Carregando dados reais...</div>}

      {!selectedClient && !loading && (
        <section className="mx-auto grid max-w-7xl gap-5 md:grid-cols-2 xl:grid-cols-3">
          {clients.map((client) => <ClientCard key={client.id} client={client} count={counts[client.id]} onOpen={() => setSelectedClientId(client.id)} />)}
        </section>
      )}

      {selectedClient && (
        <ClientWorkspace
          client={selectedClient}
          contents={clientContents}
          notes={clientNotes}
          onBack={() => setSelectedClientId(null)}
          onAddNote={addNote}
          onAddContent={() => setModal({ type: 'content' })}
          onExport={(content) => setModal({ type: 'export', content })}
          onApprove={(content) => setModal({ type: 'approve', content })}
          onMove={updateContent}
        />
      )}

      {modal?.type === 'client' && <ClientModal onClose={() => setModal(null)} onSave={addClient} />}
      {modal?.type === 'content' && <ContentModal onClose={() => setModal(null)} onSave={addContent} initialDate={nextSlot(clientContents)} />}
      {modal?.type === 'export' && <ExportModal content={modal.content} onClose={() => setModal(null)} onSave={async (patch) => { await updateContent(modal.content.id, { ...patch, status: 'aguardando_aprovacao' }); setModal(null) }} />}
      {modal?.type === 'approve' && <ApprovalModal content={modal.content} onClose={() => setModal(null)} onApprove={async () => { await updateContent(modal.content.id, { status: 'aprovado', erro_publicacao: null }); setToast(`Conteúdo aprovado e colocado na fila para ${prettyDate(modal.content.data_agendada)}. A Meta só confirma quando publicar no horário.`); setModal(null) }} onAdjust={(notas) => { updateContent(modal.content.id, { status: 'em_producao', notas }); setModal(null) }} onReject={() => { updateContent(modal.content.id, { status: 'a_criar' }); setModal(null) }} />}
    </main>
  )
}

function AuthScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setBusy(true)
    setMessage('')

    const auth = await supabase.auth.signInWithPassword({ email, password })

    if (auth.error) {
      setMessage(auth.error.message)
      setBusy(false)
      return
    }

    setMessage('Entrando...')
    setBusy(false)
  }

  return <main className="grid min-h-screen place-items-center px-4 py-8 text-zinc-100">
    <section className="glass w-full max-w-md rounded-[2rem] p-5 md:p-6">
      <p className="mb-2 text-xs uppercase tracking-[0.32em] text-zinc-500">CRM Social Media</p>
      <h1 className="text-3xl font-semibold tracking-tight text-white">Entrar no CRM</h1>
      <p className="mt-2 text-sm text-zinc-400">Acesso restrito para gerenciar clientes, aprovações e publicações automáticas.</p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-3">
        <input required type="email" placeholder="E-mail" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} />
        <input required type="password" minLength={6} placeholder="Senha" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} />
        {message && <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-300">{message}</div>}
        <button disabled={busy} className="shine w-full rounded-2xl bg-white px-4 py-3 font-medium text-black transition hover:bg-zinc-200 disabled:opacity-60">{busy ? 'Aguarde...' : 'Entrar'}</button>
      </form>
    </section>
  </main>
}

function ClientCard({ client, count, onOpen }) {
  return <button onDoubleClick={onOpen} onClick={onOpen} className="glass group min-h-56 rounded-[2rem] p-5 text-left transition duration-300 hover:-translate-y-1 hover:border-white/25 hover:bg-white/[0.12]" style={{ animation: 'float 7s ease-in-out infinite' }}>
    <div className="mb-6 flex items-center gap-4">
      <img src={client.foto_perfil_url || 'https://placehold.co/160x160/111111/FFFFFF?text=CRM'} alt="" className="h-16 w-16 rounded-3xl object-cover ring-1 ring-white/20 transition duration-300 group-hover:scale-[1.03]" />
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-white">{client.nome}</h2>
        <a href={client.instagram_url} target="_blank" className="mt-1 inline-flex items-center gap-1 text-sm text-zinc-400 transition hover:text-white"><AtSign size={14} /> @{client.instagram_url?.split('/').filter(Boolean).at(-1)} <ExternalLink size={12} /></a>
      </div>
    </div>
    <div className="grid grid-cols-2 gap-2 text-sm">
      <Badge label="A criar" value={count?.a_criar || 0} />
      <Badge label="Produção" value={count?.em_producao || 0} />
      <Badge label="Aprovação" value={count?.aguardando_aprovacao || 0} />
      <Badge label="Aprovados" value={count?.aprovado || 0} />
    </div>
  </button>
}

function Badge({ label, value }) { return <span className="rounded-2xl border border-white/8 bg-black/20 px-3 py-2 text-zinc-200">{label}: {value}</span> }

function ClientWorkspace({ client, contents, notes, onBack, onAddNote, onAddContent, onExport, onApprove, onMove }) {
  const [note, setNote] = useState('')
  return <section className="mx-auto max-w-7xl">
    <button onClick={onBack} className="mb-5 text-sm text-zinc-400 hover:text-white">← Voltar ao board</button>
    <div className="mb-6 flex flex-col justify-between gap-4 md:mb-8 md:flex-row md:items-end">
      <div>
        <h2 className="text-3xl font-semibold tracking-tight text-white md:text-4xl">{client.nome}</h2>
        <p className="mt-1 text-zinc-400">Planejamento, aprovação e publicação em um só trilho.</p>
      </div>
      <button onClick={onAddContent} className="glass inline-flex items-center gap-2 rounded-full px-4 py-3 transition hover:-translate-y-0.5 hover:bg-white/15"><CirclePlus size={18} /> Conteúdo</button>
    </div>

    <div className="grid gap-4 xl:grid-cols-[280px_1fr]">
      <aside className="glass rounded-[1.75rem] p-4">
        <div className="mb-4 flex items-center gap-2"><NotebookPen size={18} /><h3 className="font-semibold">Notas</h3></div>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nova nota sobre o cliente..." className="min-h-28 w-full rounded-3xl border border-white/10 bg-black/25 p-3 outline-none focus:border-white/35" />
        <button onClick={() => { if (note.trim()) { onAddNote(note.trim()); setNote('') } }} className="mt-3 w-full rounded-2xl bg-white px-4 py-2 font-medium text-black transition hover:bg-zinc-200">Adicionar nota</button>
        <div className="mt-4 space-y-3">
          {notes.map((item) => <article key={item.id} className="rounded-3xl border border-white/8 bg-black/20 p-3 text-sm"><p>{item.texto}</p><time className="mt-2 block text-xs text-zinc-500">{prettyDate(item.criado_em)}</time></article>)}
        </div>
      </aside>

      <div className="min-w-0 pb-2">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
          {STATUS.map(([key, label]) => <KanbanColumn key={key} title={label} items={contents.filter((item) => item.status === key && item.titulo?.trim())} onExport={onExport} onApprove={onApprove} onMove={onMove} />)}
        </div>
      </div>
    </div>
  </section>
}

function KanbanColumn({ title, items, onExport, onApprove, onMove }) {
  return <section className="glass min-h-[420px] rounded-[1.5rem] p-3 xl:min-h-[540px]">
    <div className="mb-3 flex items-center justify-between gap-2 px-1">
      <h3 className="text-sm font-semibold tracking-tight text-white 2xl:text-base">{title}</h3>
      <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-zinc-300">{items.length}</span>
    </div>
    <div className="space-y-3">
      {items.map((item) => <ContentCard key={item.id} item={item} onExport={onExport} onApprove={onApprove} onMove={onMove} />)}
    </div>
  </section>
}

function ContentCard({ item, onExport, onApprove, onMove }) {
  const dueSoon = item.data_agendada && new Date(item.data_agendada) - new Date() < 86400000 && new Date(item.data_agendada) > new Date()
  return <article className="rounded-3xl border border-white/10 bg-black/35 p-3 text-sm transition duration-300 hover:-translate-y-1 hover:border-white/20 hover:bg-white/[0.08]">
    <div className="mb-3 flex items-center justify-between gap-2"><span className="rounded-full border border-white/10 bg-white/10 px-2.5 py-1 text-xs">{TYPES.find(([key]) => key === item.tipo)?.[1]}</span>{dueSoon && <span className="rounded-full bg-white px-2 py-1 text-[11px] font-medium text-black">&lt; 24h</span>}</div>
    <h4 className="text-base font-medium text-white">{item.titulo || 'Slot livre'}</h4>
    <p className="mt-3 flex items-center gap-1.5 text-zinc-400"><CalendarClock size={14} /> {prettyDate(item.data_agendada)}</p>
    {item.referencia_url && <a href={item.referencia_url} target="_blank" className="mt-2 inline-flex items-center gap-1 text-zinc-300 underline decoration-white/20 underline-offset-4 transition hover:text-white">Referência <ExternalLink size={12} /></a>}
    <div className="mt-3 flex flex-wrap gap-2">
      {item.status === 'a_criar' && <button onClick={() => onMove(item.id, { status: 'em_producao' })} className="rounded-full border border-white/10 bg-white/10 px-3 py-2 transition hover:bg-white/20">Iniciar</button>}
      {item.status === 'em_producao' && <button onClick={() => onExport(item)} className="rounded-full bg-white px-3 py-2 font-medium text-black transition hover:bg-zinc-200">Exportar</button>}
      {item.status === 'aguardando_aprovacao' && <button onClick={() => onApprove(item)} className="rounded-full bg-white px-3 py-2 font-medium text-black transition hover:bg-zinc-200">Revisar</button>}
      {item.status === 'aprovado' && <span className="inline-flex items-center gap-1 text-zinc-200"><CheckCircle2 size={14} /> Na fila até o horário</span>}
      {item.status === 'publicado' && <span className="inline-flex items-center gap-1 text-zinc-200"><Send size={14} /> Publicado na Meta</span>}
    </div>
    {item.erro_publicacao && <p className="mt-3 rounded-2xl border border-red-400/25 bg-red-500/10 p-2 text-xs text-red-100">Falha na Meta: {item.erro_publicacao}</p>}
  </article>
}

function Shell({ title, onClose, children }) { return <div className="fixed inset-0 z-20 grid place-items-center bg-black/75 p-3 backdrop-blur-sm"><div className="glass max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-[2rem] p-4 shadow-2xl md:p-5"><div className="mb-4 flex items-center justify-between"><div><p className="mb-1 flex items-center gap-2 text-xs uppercase tracking-[0.28em] text-zinc-500"><Sparkles size={13} /> Setup inteligente</p><h2 className="text-2xl font-semibold">{title}</h2></div><button className="rounded-full border border-white/10 bg-white/5 p-2 transition hover:bg-white/10" onClick={onClose}><X size={18} /></button></div>{children}</div></div> }
const inputClass = 'w-full rounded-2xl border border-white/10 bg-white/[0.055] px-3 py-2.5 outline-none transition placeholder:text-zinc-500 focus:border-white/35 focus:bg-white/[0.09]'

function ClientModal({ onClose, onSave }) {
  const [form, setForm] = useState({ nome: '', instagram_url: '', instagram_user_id: '', access_token: '', foto_perfil_url: '', foto_perfil_file: null, frequencia: emptyFrequency })
  function updateFrequency(group, patch) { setForm((current) => ({ ...current, frequencia: { ...current.frequencia, [group]: { ...current.frequencia[group], ...patch } } })) }
  return <Shell title="Novo cliente" onClose={onClose}><form onSubmit={(e) => { e.preventDefault(); onSave(form) }} className="space-y-4">
    <div className="grid gap-3 md:grid-cols-2">
      <input required placeholder="Nome do cliente" className={inputClass} value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
      <input required placeholder="Link do Instagram" className={inputClass} value={form.instagram_url} onChange={(e) => setForm({ ...form, instagram_url: e.target.value })} />
      <input placeholder="Instagram User ID (opcional)" className={inputClass} value={form.instagram_user_id} onChange={(e) => setForm({ ...form, instagram_user_id: e.target.value })} />
      <input placeholder="Access token da Meta (opcional, mas necessário para publicar)" className={inputClass} value={form.access_token} onChange={(e) => setForm({ ...form, access_token: e.target.value })} />
      <input placeholder="URL da foto de perfil" className={inputClass} value={form.foto_perfil_url} onChange={(e) => setForm({ ...form, foto_perfil_url: e.target.value })} />
    </div>

    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-dashed border-white/15 bg-white/[0.03] p-3 text-sm text-zinc-300 transition hover:bg-white/[0.06]">
      <span><span className="block font-medium text-zinc-100">Foto de perfil</span><span className="text-zinc-500">{form.foto_perfil_file?.name || 'URL acima ou arquivo local'}</span></span>
      <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-xs">Escolher</span>
      <input className="hidden" type="file" accept="image/*" onChange={(e) => setForm({ ...form, foto_perfil_file: e.target.files?.[0] || null })} />
    </label>

    <div className="rounded-[1.75rem] border border-white/10 bg-black/20 p-3">
      <div className="mb-3 flex flex-col justify-between gap-2 md:flex-row md:items-end">
        <div>
          <h3 className="font-semibold text-white">Plano de conteúdo</h3>
          <p className="text-sm text-zinc-500">Ative só o que esse cliente realmente usa.</p>
        </div>
        <p className="rounded-full bg-white/10 px-3 py-1 text-xs text-zinc-300">{Object.values(form.frequencia).filter((cfg) => cfg.ativo).length} canais ativos</p>
      </div>
      <div className="grid gap-3 xl:grid-cols-3">
        {Object.entries(form.frequencia).map(([group, cfg]) => <ChannelPlanner key={group} group={group} cfg={cfg} onChange={updateFrequency} />)}
      </div>
    </div>

    <button className="shine w-full rounded-2xl bg-white px-4 py-3 font-medium text-black transition hover:-translate-y-0.5 hover:bg-zinc-200">Salvar cliente</button>
  </form></Shell>
}

function ChannelPlanner({ group, cfg, onChange }) {
  const meta = channelMeta[group]
  const Icon = meta.icon
  return <section className={`rounded-[1.5rem] border p-3 transition ${cfg.ativo ? 'border-white/16 bg-white/[0.06]' : 'border-white/8 bg-white/[0.025] opacity-60'}`}>
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-2xl bg-white/10"><Icon size={17} /></span>
        <div>
          <h4 className="font-semibold text-white">{meta.label}</h4>
          <p className="text-xs text-zinc-500">{meta.hint}</p>
        </div>
      </div>
      <button type="button" onClick={() => onChange(group, { ativo: !cfg.ativo })} className={`h-7 w-12 rounded-full p-1 transition ${cfg.ativo ? 'bg-white' : 'bg-zinc-700'}`} aria-label={`Ativar ${meta.label}`}>
        <span className={`block h-5 w-5 rounded-full transition ${cfg.ativo ? 'translate-x-5 bg-black' : 'bg-zinc-300'}`} />
      </button>
    </div>

    <div className="grid grid-cols-2 gap-2">
      <label className="rounded-2xl border border-white/10 bg-black/20 p-3">
        <span className="mb-1 block text-[11px] uppercase tracking-[0.18em] text-zinc-500">Qtd/semana</span>
        <input disabled={!cfg.ativo} type="number" min="1" max="14" className="w-full bg-transparent text-lg font-semibold outline-none disabled:cursor-not-allowed" value={cfg.quantidade} onChange={(e) => onChange(group, { quantidade: Number(e.target.value) })} />
      </label>
      <label className="rounded-2xl border border-white/10 bg-black/20 p-3">
        <span className="mb-1 flex items-center gap-1 text-[11px] uppercase tracking-[0.18em] text-zinc-500"><Clock size={12} /> Horário</span>
        <input disabled={!cfg.ativo} type="time" className="w-full bg-transparent text-lg font-semibold outline-none disabled:cursor-not-allowed" value={cfg.horario} onChange={(e) => onChange(group, { horario: e.target.value })} />
      </label>
    </div>

    <div className="mt-3 flex flex-wrap gap-1.5">
      {WEEKDAYS.map(([day]) => {
        const active = cfg.dias.includes(day)
        return <button disabled={!cfg.ativo} type="button" key={day} onClick={() => onChange(group, { dias: active ? cfg.dias.filter((value) => value !== day) : [...cfg.dias, day] })} className={`rounded-full px-2.5 py-1 text-xs transition disabled:cursor-not-allowed ${active ? 'bg-white text-black' : 'bg-black/25 text-zinc-400 hover:bg-white/10 hover:text-white'}`}>
          {day.slice(0, 3)}
        </button>
      })}
    </div>
  </section>
}

function ContentModal({ onClose, onSave, initialDate }) { const [form, setForm] = useState({ titulo: '', tipo: 'feed_foto', referencia_url: '', notas: '', data_agendada: toDateTimeLocalValue(initialDate) }); return <Shell title="Novo conteúdo" onClose={onClose}><form onSubmit={(e) => { e.preventDefault(); onSave({ ...form, data_agendada: localDateTimeToIso(form.data_agendada) }) }} className="space-y-4"><input className={inputClass} placeholder="Título" value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} /><select className={inputClass} value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>{TYPES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><input className={inputClass} placeholder="Link de referência" value={form.referencia_url} onChange={(e) => setForm({ ...form, referencia_url: e.target.value })} /><input type="datetime-local" className={inputClass} value={form.data_agendada} onChange={(e) => setForm({ ...form, data_agendada: e.target.value })} /><p className="text-xs text-zinc-500">Horário planejado: {form.data_agendada ? prettyDate(localDateTimeToIso(form.data_agendada)) : 'selecione data e hora'}</p><textarea className={inputClass} placeholder="Observações" value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} /><button className="w-full rounded-2xl bg-white text-black transition hover:bg-zinc-200 px-4 py-3">Adicionar</button></form></Shell> }

function ExportModal({ content, onClose, onSave }) {
  const [urls, setUrls] = useState(content.midia_urls.join('\n'))
  const [files, setFiles] = useState([])
  const [legenda, setLegenda] = useState(content.legenda || '')
  const [date, setDate] = useState(toDateTimeLocalValue(content.data_agendada))
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setBusy(true)
    const uploaded = files.length
      ? await Promise.all(files.map((file) => uploadPublicFile(file, content.tipo === 'stories' ? 'stories' : content.tipo === 'reels' ? 'reels' : 'content')))
      : []
    const manualUrls = urls.split('\n').map((u) => u.trim()).filter(Boolean)
    await onSave({
      midia_urls: [...manualUrls, ...uploaded],
      legenda,
      data_agendada: localDateTimeToIso(date),
    })
    setBusy(false)
  }

  return <Shell title="Exportar conteúdo" onClose={onClose}>
    <form onSubmit={handleSubmit} className="space-y-4">
      <label className="block rounded-2xl border border-dashed border-white/15 bg-white/[0.03] p-3 text-sm text-zinc-300">
        <span className="mb-2 block">Enviar mídia para o Storage</span>
        <input
          type="file"
          multiple={content.tipo === 'feed_carrossel'}
          accept={content.tipo === 'reels' ? 'video/*' : content.tipo === 'stories' ? 'image/*,video/*' : 'image/*'}
          onChange={(e) => setFiles(Array.from(e.target.files || []))}
        />
      </label>
      <textarea className={inputClass} placeholder="Ou cole uma URL pública por linha" value={urls} onChange={(e) => setUrls(e.target.value)} />
      <textarea className={inputClass} placeholder="Legenda" value={legenda} onChange={(e) => setLegenda(e.target.value)} />
      <p className="text-right text-sm text-zinc-400">{legenda.length} caracteres</p>
      <input type="datetime-local" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
      <button disabled={busy} className="w-full rounded-2xl bg-white px-4 py-3 text-black transition hover:bg-zinc-200 disabled:opacity-60">{busy ? 'Enviando...' : 'Enviar para aprovação'}</button>
    </form>
  </Shell>
}

function ApprovalModal({ content, onClose, onApprove, onAdjust, onReject }) { const [notes, setNotes] = useState(''); return <Shell title="Aprovação de conteúdo" onClose={onClose}><div className="space-y-4">{content.midia_urls[0] && <img src={content.midia_urls[0]} alt="" className="max-h-80 w-full rounded-3xl object-cover" />}<div className="rounded-3xl border border-white/10 bg-white/[0.05] p-4"><p className="mb-2 text-sm text-slate-400">{TYPES.find(([key]) => key === content.tipo)?.[1]}</p><p className="mb-3 rounded-2xl bg-black/25 px-3 py-2 text-sm text-zinc-200"><CalendarClock className="mr-1 inline" size={14} /> Planejado para {prettyDate(content.data_agendada)}</p><p>{content.legenda || 'Sem legenda'}</p></div><p className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-sm text-zinc-300">Ao aprovar, o conteúdo entra na fila para esse horário planejado. Se precisar mudar em cima da hora, ajuste a data antes de aprovar.</p><textarea className={inputClass} placeholder="Observação para ajuste" value={notes} onChange={(e) => setNotes(e.target.value)} /><div className="grid gap-2 md:grid-cols-3"><button onClick={onApprove} className="rounded-2xl bg-white px-4 py-3 text-black">Aprovar e colocar na fila</button><button onClick={() => onAdjust(notes)} className="rounded-2xl bg-zinc-200 px-4 py-3 text-black">Solicitar ajuste</button><button onClick={onReject} className="rounded-2xl bg-zinc-700 px-4 py-3">Reprovar</button></div></div></Shell> }

export default App


