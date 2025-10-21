const db = require('../config/database');
const fs = require('fs').promises;
const path = require('path');

class WeekSpreadsheet {
  /**
   * Upload and save a spreadsheet for a week
   * @param {Object} spreadsheetData - Spreadsheet data
   * @returns {Promise<Object>} Created spreadsheet record
   */
  static async uploadSpreadsheet(spreadsheetData) {
    try {
      const {
        week_number,
        season_year,
        original_filename,
        stored_filename,
        file_path,
        file_size,
        uploaded_by
      } = spreadsheetData;

      // Check if a spreadsheet already exists for this week
      const existing = await this.getSpreadsheetByWeek(week_number, season_year);

      if (existing) {
        // Delete old file
        try {
          await fs.unlink(existing.file_path);
        } catch (err) {
          console.error('Error deleting old spreadsheet file:', err);
        }

        // Update existing record
        const updateQuery = `
          UPDATE week_spreadsheets
          SET original_filename = ?,
              stored_filename = ?,
              file_path = ?,
              file_size = ?,
              game_type = 'primary',
              uploaded_at = CURRENT_TIMESTAMP,
              uploaded_by = ?
          WHERE spreadsheet_id = ?
        `;

        await db.query(updateQuery, [
          original_filename,
          stored_filename,
          file_path,
          file_size,
          uploaded_by,
          existing.spreadsheet_id
        ]);

        return { spreadsheet_id: existing.spreadsheet_id };
      } else {
        // Insert new record
        const insertQuery = `
          INSERT INTO week_spreadsheets
            (week_number, season_year, game_type, original_filename, stored_filename, file_path, file_size, uploaded_by)
          VALUES (?, ?, 'primary', ?, ?, ?, ?, ?)
        `;

        const result = await db.query(insertQuery, [
          week_number,
          season_year,
          original_filename,
          stored_filename,
          file_path,
          file_size,
          uploaded_by
        ]);

        return { spreadsheet_id: result.insertId };
      }
    } catch (error) {
      console.error('Error uploading spreadsheet:', error);
      throw error;
    }
  }

  /**
   * Get spreadsheet for a specific week
   * @param {number} weekNumber - Week number
   * @param {number} seasonYear - Season year
   * @returns {Promise<Object|null>} Spreadsheet object or null
   */
  static async getSpreadsheetByWeek(weekNumber, seasonYear = 2025) {
    try {
      const query = `
        SELECT * FROM week_spreadsheets
        WHERE week_number = ? AND season_year = ?
      `;

      const spreadsheets = await db.query(query, [weekNumber, seasonYear]);
      return spreadsheets.length > 0 ? spreadsheets[0] : null;
    } catch (error) {
      console.error('Error fetching spreadsheet by week:', error);
      throw error;
    }
  }

  /**
   * Get spreadsheet by ID
   * @param {number} spreadsheetId - Spreadsheet ID
   * @returns {Promise<Object|null>} Spreadsheet object or null
   */
  static async getSpreadsheetById(spreadsheetId) {
    try {
      const query = `
        SELECT * FROM week_spreadsheets
        WHERE spreadsheet_id = ?
      `;

      const spreadsheets = await db.query(query, [spreadsheetId]);
      return spreadsheets.length > 0 ? spreadsheets[0] : null;
    } catch (error) {
      console.error('Error fetching spreadsheet by ID:', error);
      throw error;
    }
  }

  /**
   * Get all spreadsheets for a season
   * @param {number} seasonYear - Season year
   * @returns {Promise<Array>} Array of spreadsheets
   */
  static async getSeasonSpreadsheets(seasonYear = 2025) {
    try {
      const query = `
        SELECT * FROM week_spreadsheets
        WHERE season_year = ?
        ORDER BY week_number, game_type DESC
      `;

      const spreadsheets = await db.query(query, [seasonYear]);
      return spreadsheets;
    } catch (error) {
      console.error('Error fetching season spreadsheets:', error);
      throw error;
    }
  }

  /**
   * Delete spreadsheet
   * @param {number} spreadsheetId - Spreadsheet ID
   * @returns {Promise<Object>} Result
   */
  static async deleteSpreadsheet(spreadsheetId) {
    try {
      // Get file path first
      const spreadsheet = await this.getSpreadsheetById(spreadsheetId);

      if (spreadsheet) {
        // Delete file
        try {
          await fs.unlink(spreadsheet.file_path);
        } catch (err) {
          console.error('Error deleting spreadsheet file:', err);
        }

        // Delete database record
        const query = `
          DELETE FROM week_spreadsheets
          WHERE spreadsheet_id = ?
        `;

        const result = await db.query(query, [spreadsheetId]);
        return result;
      }

      return null;
    } catch (error) {
      console.error('Error deleting spreadsheet:', error);
      throw error;
    }
  }

  /**
   * Check if a spreadsheet exists for a week
   * @param {number} weekNumber - Week number
   * @param {number} seasonYear - Season year
   * @returns {Promise<boolean>} True if spreadsheet exists
   */
  static async hasSpreadsheet(weekNumber, seasonYear = 2025) {
    try {
      const spreadsheet = await this.getSpreadsheetByWeek(weekNumber, seasonYear);
      return spreadsheet !== null;
    } catch (error) {
      console.error('Error checking if spreadsheet exists:', error);
      throw error;
    }
  }
}

module.exports = WeekSpreadsheet;
