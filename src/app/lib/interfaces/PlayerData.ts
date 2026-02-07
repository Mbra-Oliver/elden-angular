export type PlayerState =
  | 'idle' // Le joueur ne produit aucune entrée et est immobile
  | 'moving' // Le joueur se déplace (une touche de direction est active)
  | 'attacking' // En attaque
  | 'rolling' //En roullade (dodge)
  | 'hurt' // Le joueur a reçu un dégât (état prioritaire)
  | 'exhausted' // Le joueur est en exhaus­tion
  | 'dead'; // Le joueur n'a plus de PV

//Fiche de stat globale du joueur
export interface PlayerData {
  //Positions
  x: number;
  y: number;

  //Vitesse

  vx: number; //Vélocity X (pixels/secondes)
  vy: number; //Vélocity Y (pixels/secondes)

  // ----DIRECTION DU REGARD

  facingX: number; // (-1, 0 ou 1)
  facingY: number;

  // ----STATS

  hp: number; // Points de vie
  stamina: number; // Points de souffle
  maxStamina: number; // Points de souffle max
  maxHp: number; // Points de vie max

  // ----- État

  state: PlayerState;
  stateTimer: number; //Temps restant pour sortir de l'etat actuel (ms)

  // ---- COMBAT

  invicible: boolean; // Indique si le joueur est invincible (Oui pendant le roll)
  attackType: 'light' | 'heavy' | 'none';
  comboCount: number; //Index du combo
  comboTimer: number;
}
