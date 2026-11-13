import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  await auth.ensureLoaded();
  if (auth.me()) return true;
  return inject(Router).createUrlTree(['/login'], { queryParams: { next: state.url } });
};

export const adminGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  await auth.ensureLoaded();
  return auth.isAdmin() ? true : inject(Router).createUrlTree(['/dashboard']);
};

export const userGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  await auth.ensureLoaded();
  return auth.isUser() ? true : inject(Router).createUrlTree(['/dashboard']);
};

/** The home page is for visitors: someone who is signed in lands on their dashboard instead. */
export const homeGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  await auth.ensureLoaded();
  return auth.me() ? inject(Router).createUrlTree(['/dashboard']) : true;
};
