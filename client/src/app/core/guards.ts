import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

// inject() only works before the first await, so everything is injected up front.

/** Lets everyone in, but makes sure the sign-in state is known before the page renders. */
export const loadAuthGuard: CanActivateFn = async () => {
  await inject(AuthService).ensureLoaded();
  return true;
};

/** Pages that need an account: visitors are sent to sign in and come back afterwards. */
export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.ensureLoaded();
  if (auth.me()) return true;
  return router.createUrlTree(['/login'], { queryParams: { next: state.url } });
};

export const adminGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.ensureLoaded();
  if (!auth.me()) return router.createUrlTree(['/login'], { queryParams: { next: state.url } });
  return auth.isAdmin() ? true : router.createUrlTree(['/dashboard']);
};

export const userGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.ensureLoaded();
  if (!auth.me()) return router.createUrlTree(['/login'], { queryParams: { next: state.url } });
  return auth.isUser() ? true : router.createUrlTree(['/dashboard']);
};
