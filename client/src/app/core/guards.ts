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

export const guestGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  await auth.ensureLoaded();
  return auth.isGuest() ? true : inject(Router).createUrlTree(['/dashboard']);
};
