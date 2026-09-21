using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Lakeland.OrderFulfilment.Api.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class SwitchPrintCatalogToPrintful : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.UpdateData(
                table: "product_variants",
                keyColumn: "Id",
                keyValue: new Guid("22222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
                columns: new[] { "Provider", "ProviderProductId" },
                values: new object[] { "Printful", "CONFIGURE_PRINTFUL_MAPPING" });

            migrationBuilder.UpdateData(
                table: "products",
                keyColumn: "Id",
                keyValue: new Guid("22222222-2222-2222-2222-222222222222"),
                column: "Description",
                value: "Art reproduction fulfilled by Printful; product approval pending.");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.UpdateData(
                table: "product_variants",
                keyColumn: "Id",
                keyValue: new Guid("22222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
                columns: new[] { "Provider", "ProviderProductId" },
                values: new object[] { "Prodigi", "CONFIGURE_PRODIGI_MAPPING" });

            migrationBuilder.UpdateData(
                table: "products",
                keyColumn: "Id",
                keyValue: new Guid("22222222-2222-2222-2222-222222222222"),
                column: "Description",
                value: "Archival reproduction fulfilled by Prodigi.");
        }
    }
}
