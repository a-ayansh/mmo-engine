class EloCalculator {
  static validateInputs(playerRating, opponentRating, result) {
    if (typeof playerRating !== 'number' || typeof opponentRating !== 'number') {
      throw new Error('Ratings must be numbers');
    }

    if (!['win', 'loss', 'draw'].includes(result)) {
      throw new Error('Result must be "win", "loss", or "draw"');
    }
  }

  static calculateExpectedScore(playerRating, opponentRating) {
    return 1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400));
  }

  static getActualScore(result) {
    switch (result) {
      case 'win': return 1;
      case 'loss': return 0;
      case 'draw': return 0.5;
    }
  }

  static calculateNewRating(playerRating, opponentRating, result, kFactor = 32) {
    this.validateInputs(playerRating, opponentRating, result);

    const expectedScore = this.calculateExpectedScore(playerRating, opponentRating);
    const actualScore = this.getActualScore(result);

    const newRating = playerRating + kFactor * (actualScore - expectedScore);
    return Math.round(Math.max(100, newRating));
  }

  static calculateRatingChange(playerRating, opponentRating, result, kFactor = 32) {
    this.validateInputs(playerRating, opponentRating, result);

    const newRating = this.calculateNewRating(playerRating, opponentRating, result, kFactor);
    return newRating - playerRating;
  }
}

export default EloCalculator;
