export default async function handler(req, res) {
  const { slug } = req.query;

  if (!slug || slug.length < 2) {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  const protocol = slug[0];
  const domain = slug[1];
  const path = slug.slice(2).join('/');

  if (!['http', 'https'].includes(protocol)) {
    return res.status(400).json({ error: 'Invalid protocol' });
  }

  const targetUrl = `${protocol}://${domain}${path ? '/' + path : ''}`;

  const queryString = new URLSearchParams(req.query);
  queryString.delete('slug');
  const finalUrl = queryString.toString()
    ? `${targetUrl}?${queryString.toString()}`
    : targetUrl;

  try {
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
      return res.status(204).end();
    }

    const headers = {
      'Host': domain,
      'User-Agent': req.headers['user-agent'] || 'Vercel-Proxy/1.0',
    };

    const allowedHeaders = ['content-type', 'authorization', 'accept', 'accept-language', 'cache-control'];
    allowedHeaders.forEach(header => {
      if (req.headers[header]) {
        headers[header] = req.headers[header];
      }
    });

    // 禁用缓存
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('X-Accel-Buffering', 'no');

    // 设置CORS头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

    // 发起请求，禁用缓存
    const response = await fetch(finalUrl, {
      method: req.method,
      headers: {
        ...headers,
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      },
      body: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
      duplex: 'half'
    });

    // 复制上游响应头，但排除可能导致缓存的头
    response.headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase();
      if (!['content-encoding', 'transfer-encoding', 'connection', 'content-length', 'cache-control', 'etag', 'last-modified'].includes(lowerKey)) {
        res.setHeader(key, value);
      }
    });

    // 强制设置不缓存
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    // 设置状态码
    res.status(response.status);

    // 处理流式响应
    if (response.body) {
      const reader = response.body.getReader();
      
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          break;
        }
        
        // 立即将数据块写入响应
        res.write(Buffer.from(value));
        
        // 强制刷新缓冲区
        if (res.flush) {
          res.flush();
        }
      }
    }
    
    res.end();

  } catch (error) {
    console.error('Proxy error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Proxy request failed',
        message: error.message,
      });
    } else if (!res.writableEnded) {
      res.end();
    }
  }
}

// 禁用body解析器，以便处理原始请求体
export const config = {
  api: {
    bodyParser: false,
  },
};