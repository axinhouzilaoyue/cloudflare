addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  const apiUrl = 'https://www.wetest.vip/api/cf2dns/get_cloudflare_ip?key=o1zrmHAF&type=v6'
  
  try {
    const response = await fetch(apiUrl)
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    
    const data = await response.json()
    
    if (!data.status || !data.info) {
      throw new Error('Invalid data format')
    }

    let result = []
    
    // 处理所有移动IP
    if (data.info.CM) {
      result.push(...data.info.CM.map(ip => `[${ip.address}]#移动-IPV6`))
    }
    
    // 处理所有联通IP
    if (data.info.CU) {
      result.push(...data.info.CU.map(ip => `[${ip.address}]#联通-IPV6`))
    }
    
    // 处理所有电信IP
    if (data.info.CT) {
      result.push(...data.info.CT.map(ip => `[${ip.address}]#电信-IPV6`))
    }
    
    // 将数组转换为换行分隔的字符串
    const formattedResult = result.join('\n')
    
    return new Response(formattedResult, {
      headers: {
        'content-type': 'text/plain;charset=UTF-8',
        'Access-Control-Allow-Origin': '*'
      }
    })
    
  } catch (error) {
    return new Response(`Error: ${error.message}`, {
      status: 500,
      headers: {
        'content-type': 'text/plain;charset=UTF-8',
        'Access-Control-Allow-Origin': '*'
      }
    })
  }
}
