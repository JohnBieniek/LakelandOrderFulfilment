using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Lakeland.OrderFulfilment.Api.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddStorefrontCheckout : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "storefront_checkouts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OwnerHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    CartHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    SessionId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    SessionUrl = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_storefront_checkouts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_storefront_checkouts_orders_Id",
                        column: x => x.Id,
                        principalTable: "orders",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_storefront_checkouts_SessionId",
                table: "storefront_checkouts",
                column: "SessionId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "storefront_checkouts");
        }
    }
}
