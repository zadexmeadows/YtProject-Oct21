import { NextRequest, NextResponse } from 'next/server';

const SESSION_COOKIE_NAME = 'ytbot.sid';
const DEFAULT_PROTECTED_PATH = '/dashboard';

export async function middleware(request: NextRequest) {
  if (request.nextUrl.pathname === '/login') {
    return noStoreResponse();
  }

  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME);
  if (!sessionCookie) {
    return redirectToLogin(request);
  }

  try {
    const response = await fetch(`${internalApiUrl()}/auth/session`, {
      method: 'GET',
      headers: {
        cookie: request.headers.get('cookie') ?? ''
      },
      cache: 'no-store'
    });

    if (!response.ok) {
      return redirectToLogin(request);
    }
  } catch {
    return redirectToLogin(request);
  }

  return noStoreResponse();
}

function noStoreResponse() {
  const response = NextResponse.next();
  response.headers.set('Cache-Control', 'private, no-store, max-age=0');
  return response;
}

function redirectToLogin(request: NextRequest) {
  const loginUrl = new URL('/login', request.url);
  const requestedPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  if (requestedPath !== DEFAULT_PROTECTED_PATH) {
    loginUrl.searchParams.set('next', requestedPath);
  }
  return NextResponse.redirect(loginUrl);
}

function internalApiUrl() {
  return (
    process.env.INTERNAL_API_URL ??
    (process.env.NODE_ENV === 'production' ? 'http://api:4000' : 'http://localhost:4000')
  ).replace(/\/+$/, '');
}

export const config = {
  matcher: ['/((?!api(?:/|$)|_next/static|_next/image|favicon.ico|firebase-messaging-sw.js|robots.txt|sitemap.xml).*)']
};
