import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type ContentType = 'feed_foto' | 'feed_carrossel' | 'reels' | 'stories'

type DueContent = {
  id: string
  cliente_id: string
  tipo: ContentType
  midia_urls: string[] | null
  legenda: string | null
  data_agendada: string | null
  clientes: {
    instagram_user_id: string | null
  } | null
}

const supabaseUrl = Deno.env.get('SUPABASE_URL')
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nos secrets da Edge Function.')
}

const supabase = createClient(supabaseUrl, serviceRoleKey)
const graphVersion = Deno.env.get('META_GRAPH_VERSION') || 'v23.0'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

function stringifyError(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return JSON.stringify(error)
}

function assertPublicMedia(item: DueContent) {
  const urls = item.midia_urls?.filter(Boolean) ?? []
  if (!urls.length) throw new Error('Conteúdo sem mídia pública em midia_urls.')
  for (const url of urls) {
    if (!/^https:\/\//i.test(url)) throw new Error(`URL de mídia inválida ou não pública: ${url}`)
  }
  return urls
}

function isVideoUrl(url: string) {
  return /\.(mp4|mov|m4v)(\?|#|$)/i.test(url)
}

function graphBaseUrl(accessToken: string) {
  // Tokens gerados pelo Instagram Login/API Setup costumam começar com IGA
  // e precisam ser usados em graph.instagram.com. Tokens Page/User do fluxo
  // Facebook Login continuam usando graph.facebook.com.
  return accessToken.startsWith('IGA')
    ? `https://graph.instagram.com/${graphVersion}`
    : `https://graph.facebook.com/${graphVersion}`
}

async function graphPost(path: string, params: Record<string, string>) {
  const response = await fetch(`${graphBaseUrl(params.access_token)}/${path}`, {
    method: 'POST',
    body: new URLSearchParams(params),
  })
  const json = await response.json().catch(() => ({}))
  if (!response.ok) {
    const metaMessage = json?.error?.message || JSON.stringify(json)
    const code = json?.error?.code ? ` code=${json.error.code}` : ''
    const subcode = json?.error?.error_subcode ? ` subcode=${json.error.error_subcode}` : ''
    throw new Error(`Meta Graph API falhou:${code}${subcode} ${metaMessage}`)
  }
  return json
}

async function graphGet(path: string, params: Record<string, string>) {
  const url = new URL(`${graphBaseUrl(params.access_token)}/${path}`)
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value))
  const response = await fetch(url)
  const json = await response.json().catch(() => ({}))
  if (!response.ok) {
    const metaMessage = json?.error?.message || JSON.stringify(json)
    throw new Error(`Meta Graph API falhou no GET: ${metaMessage}`)
  }
  return json
}

async function publishContainer(igUserId: string, creationId: string, accessToken: string) {
  const published = await graphPost(`${igUserId}/media_publish`, {
    creation_id: creationId,
    access_token: accessToken,
  })
  if (!published.id) throw new Error('Meta não retornou instagram_post_id no media_publish.')
  return published.id as string
}

async function waitUntilFinished(creationId: string, accessToken: string) {
  const maxAttempts = Number(Deno.env.get('META_VIDEO_MAX_ATTEMPTS') || 24)
  const intervalMs = Number(Deno.env.get('META_VIDEO_POLL_INTERVAL_MS') || 5000)

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const status = await graphGet(creationId, {
      fields: 'status_code',
      access_token: accessToken,
    })

    if (status.status_code === 'FINISHED') return
    if (['ERROR', 'EXPIRED'].includes(status.status_code)) {
      throw new Error(`Processamento da mídia falhou na Meta: ${status.status_code}`)
    }

    await sleep(intervalMs)
  }

  throw new Error('Tempo esgotado aguardando processamento do vídeo na Meta.')
}

async function publishFeedPhoto(item: DueContent, igUserId: string, accessToken: string) {
  const [imageUrl] = assertPublicMedia(item)
  const container = await graphPost(`${igUserId}/media`, {
    image_url: imageUrl,
    caption: item.legenda ?? '',
    access_token: accessToken,
  })
  return publishContainer(igUserId, container.id, accessToken)
}

async function publishCarousel(item: DueContent, igUserId: string, accessToken: string) {
  const urls = assertPublicMedia(item)
  if (urls.length < 2) throw new Error('Carrossel precisa de pelo menos 2 imagens.')

  const children = []
  for (const imageUrl of urls) {
    const child = await graphPost(`${igUserId}/media`, {
      image_url: imageUrl,
      is_carousel_item: 'true',
      access_token: accessToken,
    })
    children.push(child.id)
  }

  const carousel = await graphPost(`${igUserId}/media`, {
    media_type: 'CAROUSEL',
    children: children.join(','),
    caption: item.legenda ?? '',
    access_token: accessToken,
  })

  return publishContainer(igUserId, carousel.id, accessToken)
}

async function publishReel(item: DueContent, igUserId: string, accessToken: string) {
  const [videoUrl] = assertPublicMedia(item)
  const reel = await graphPost(`${igUserId}/media`, {
    media_type: 'REELS',
    video_url: videoUrl,
    caption: item.legenda ?? '',
    access_token: accessToken,
  })

  await waitUntilFinished(reel.id, accessToken)
  return publishContainer(igUserId, reel.id, accessToken)
}

async function publishStory(item: DueContent, igUserId: string, accessToken: string) {
  const [mediaUrl] = assertPublicMedia(item)
  const story = await graphPost(`${igUserId}/media`, {
    media_type: 'STORIES',
    [isVideoUrl(mediaUrl) ? 'video_url' : 'image_url']: mediaUrl,
    access_token: accessToken,
  })

  if (isVideoUrl(mediaUrl)) await waitUntilFinished(story.id, accessToken)
  return publishContainer(igUserId, story.id, accessToken)
}

async function getAccessToken(item: DueContent) {
  const { data: secret, error } = await supabase
    .from('cliente_segredos')
    .select('access_token')
    .eq('cliente_id', item.cliente_id)
    .maybeSingle()

  if (error) throw error

  const token = secret?.access_token
  if (!token) throw new Error('Token ausente para este cliente. Cadastre access_token em cliente_segredos.')
  return token as string
}

async function publishItem(item: DueContent) {
  const igUserId = item.clientes?.instagram_user_id
  if (!igUserId) throw new Error('instagram_user_id ausente para este cliente.')

  const accessToken = await getAccessToken(item)

  switch (item.tipo) {
    case 'feed_foto':
      return publishFeedPhoto(item, igUserId, accessToken)
    case 'feed_carrossel':
      return publishCarousel(item, igUserId, accessToken)
    case 'reels':
      return publishReel(item, igUserId, accessToken)
    case 'stories':
      return publishStory(item, igUserId, accessToken)
    default:
      throw new Error(`Tipo de conteúdo não suportado: ${item.tipo}`)
  }
}

async function logPublication(contentId: string, level: 'info' | 'error', message: string, meta: Record<string, unknown> = {}) {
  await supabase.from('logs_publicacao').insert({
    conteudo_id: contentId,
    nivel: level,
    mensagem: message,
    meta,
  })
}

Deno.serve(async (request) => {
  if (!['GET', 'POST'].includes(request.method)) {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const now = new Date().toISOString()
  const { data: due, error } = await supabase
    .from('conteudos')
    .select('id, cliente_id, tipo, midia_urls, legenda, data_agendada, clientes!inner(instagram_user_id)')
    .eq('status', 'aprovado')
    .lte('data_agendada', now)
    .order('data_agendada', { ascending: true })
    .limit(25)

  if (error) return jsonResponse({ error }, 500)

  const results = []
  for (const item of (due ?? []) as DueContent[]) {
    try {
      await supabase
        .from('conteudos')
        .update({ erro_publicacao: null })
        .eq('id', item.id)

      await logPublication(item.id, 'info', 'Iniciando publicação automática.', {
        tipo: item.tipo,
        data_agendada: item.data_agendada,
      })

      const instagramPostId = await publishItem(item)
      const publishedAt = new Date().toISOString()

      const { error: updateError } = await supabase
        .from('conteudos')
        .update({
          status: 'publicado',
          instagram_post_id: instagramPostId,
          data_publicado: publishedAt,
          erro_publicacao: null,
        })
        .eq('id', item.id)

      if (updateError) throw updateError

      await logPublication(item.id, 'info', 'Publicado com sucesso na Meta.', {
        instagram_post_id: instagramPostId,
        data_publicado: publishedAt,
      })

      results.push({ id: item.id, ok: true, instagram_post_id: instagramPostId })
    } catch (err) {
      const message = stringifyError(err)
      const isTokenError = /token|OAuth|permission|permiss/i.test(message)
      const finalMessage = isTokenError
        ? `Erro de token/permissão Meta: ${message}`
        : message

      await supabase
        .from('conteudos')
        .update({
          status: 'erro_publicacao',
          erro_publicacao: finalMessage,
        })
        .eq('id', item.id)

      await logPublication(item.id, 'error', finalMessage, {
        tipo: item.tipo,
        data_agendada: item.data_agendada,
      })

      results.push({ id: item.id, ok: false, error: finalMessage })
    }
  }

  return jsonResponse({ checked_at: now, processed: results.length, results })
})
